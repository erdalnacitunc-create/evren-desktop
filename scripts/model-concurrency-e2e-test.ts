/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { modelGate } from '../src/main/agent/modelGate'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * Model istek kapısı — gerçek ajan yolu (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/model-concurrency-e2e-test.ts
 *
 * ## Neden
 *
 * Birim testi sayacın doğru olduğunu gösterir; bu test **kablolamayı** doğrular:
 * üç alt ajan aynı anda koşarken sağlayıcıya giden eşzamanlı istek sayısı
 * kapının üst sınırını aşmamalı. 0.4.24'te tam bu aşıldı (3 > 2) ve tur düştü.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
let total = 0
function check(label: string, actual: unknown, expected: unknown): void {
  total += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface Stats {
  inflight: number
  maxInflight: number
  requests: number
}

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number; stats: Stats }> {
  const stats: Stats = { inflight: 0, maxInflight: 0, requests: 0 }
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      void raw
      stats.requests += 1
      stats.inflight += 1
      stats.maxInflight = Math.max(stats.maxInflight, stats.inflight)

      // Yanıtı geciktir: isteklerin gerçekten üst üste binmesini sağla.
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(sse({ choices: [{ delta: { content: 'Kısa sonuç: tamam.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        stats.inflight -= 1
      }, 300)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        stats
      })
    })
  })
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'model-concurrency')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src'), { recursive: true })
  writeFileSync(join(base, 'src', 'a.ts'), 'const a = 1\n', 'utf8')

  const { server, port, stats } = await startServer()

  const run = (index: number) =>
    runWithWorkspace(base, () =>
      runSubagent({
        parentRequestId: `req-conc-${index}`,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'explore',
        prompt: `src içindeki dosyayı oku (koşu ${index})`,
        workspaceRoot: base,
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )

  const results = await Promise.all([run(1), run(2), run(3)])
  server.close()

  console.log(
    `  · istek=${stats.requests} · en fazla eşzamanlı=${stats.maxInflight} · kapı=${modelGate.maxConcurrent}`
  )
  check('tüm ajanlar tamamlandı', results.every((result) => result.ok), true)
  check('eşzamanlılık kapıyı aşmadı', stats.maxInflight <= modelGate.maxConcurrent, true)
  // Gerçekten paralel çalıştığını da kanıtla: aksi hâlde test "hep 1" ile de geçerdi.
  check('paralellik kullanıldı', stats.maxInflight, 2)
  check('kapı sonunda boş', modelGate.snapshot().active, 0)

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
