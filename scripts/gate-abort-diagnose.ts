/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { modelGate } from '../src/main/agent/modelGate'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * TANI: iptal sırasında eşzamanlılık neden 4 ölçülüyor? (0.4.25)
 * Çalıştırma: node scripts/run-unit.cjs scripts/gate-abort-diagnose.ts
 *
 * S5 kaos testi üç koşunun ikisinde "ölçülen 4, sınır 2" verdi. Bunun iki
 * olası nedeni var ve ikisi **çok farklı** sonuç doğurur:
 *
 *  A) Ölçüm hatası: sunucu, iptal edilen ama henüz TCP'si kapanmamış isteği
 *     "canlı" sayıyor. Kapı doğru; yalnızca sayaç yanlış.
 *  B) Gerçek kapı hatası: kapı slotu erken bırakıyor, istemci gerçekten
 *     sınırın üstünde istek açıyor. Üretimde 429 fırtınası demek.
 *
 * Bu betik her isteğin yaşam döngüsünü (start/close/end + iptal) zaman
 * damgasıyla kaydeder ve **iki ayrı ölçüm** üretir:
 *
 *  - `maxLive`     : start→close arası tüm istekler (TCP düzeyi)
 *  - `maxCompleted`: start→end arası, iptal edilmeyenler (sağlayıcının
 *                    gerçekten iş sayacağı istekler)
 *
 * Karar bu ikisinin karşılaştırmasına bağlı.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface Rec {
  id: number
  tag: string
  start: number
  end?: number
  close?: number
  aborted: boolean
}

function startServer(delayMs: number) {
  const recs: Rec[] = []
  let seq = 0
  let live = 0
  let maxLive = 0
  let completed = 0
  let maxCompleted = 0

  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const id = ++seq
      const tag = /TAG:([A-Za-z0-9_-]+)/.exec(raw)?.[1] ?? `anon${id}`
      const rec: Rec = { id, tag, start: Date.now(), aborted: false }
      recs.push(rec)

      live += 1
      maxLive = Math.max(maxLive, live)
      completed += 1
      maxCompleted = Math.max(maxCompleted, completed)

      let settled = false
      const settle = (aborted: boolean): void => {
        if (settled) return
        settled = true
        live -= 1
        completed -= 1
        rec.aborted = aborted
        if (aborted) rec.close = Date.now()
      }

      response.on('close', () => {
        rec.close = rec.close ?? Date.now()
        if (!response.writableEnded) settle(true)
      })

      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(sse({ choices: [{ delta: { content: 'tamam' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        rec.end = Date.now()
        settle(false)
      }, delayMs)
    })
  })

  return new Promise<{
    server: ReturnType<typeof createServer>
    port: number
    stats: () => { maxLive: number; maxCompleted: number; recs: Rec[] }
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        stats: () => ({ maxLive, maxCompleted, recs })
      })
    })
  })
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'abort-diag')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src'), { recursive: true })
  writeFileSync(join(base, 'src', 'a.ts'), 'const a = 1\n', 'utf8')

  const delayMs = 900
  const { server, port, stats } = await startServer(delayMs)

  const run = (tag: string, controller: AbortController) =>
    runWithWorkspace(base, () =>
      runSubagent({
        parentRequestId: `req-${tag}`,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'diag',
        agentType: 'explore',
        prompt: `TAG:${tag} — src/a.ts oku.`,
        workspaceRoot: base,
        mode: 'auto',
        profile: 'build',
        controller,
        send: () => undefined
      })
    ).catch(() => null)

  // 6 ajan: 2'si anında slot alır, 4'ü kuyruğa girer.
  const controllers = Array.from({ length: 6 }, () => new AbortController())
  const runs = controllers.map((controller, index) => run(`r${index}`, controller))

  // Kuyruktakileri iptal et (slot almamış olanlar).
  await sleep(120)
  // UÇUŞTAKİ istekleri iptal et (slot sahibi olanlar).
  for (const controller of controllers.slice(0, 2)) controller.abort()
  await Promise.all(runs)
  await sleep(1500) // kapanmalar otursun

  const result = stats()
  server.closeAllConnections?.()
  server.close()

  const aborted = result.recs.filter((rec) => rec.aborted)
  const done = result.recs.filter((rec) => !rec.aborted)
  console.log(`\n=== tanı: iptal ve eşzamanlılık ===`)
  console.log(`istek=${result.recs.length} · iptal=${aborted.length} · tamamlanan=${done.length}`)
  console.log(`TCP düzeyi en fazla canlı (maxLive)      = ${result.maxLive}`)
  console.log(`Sadece tamamlananlar (maxCompleted)      = ${result.maxCompleted}`)
  console.log(`kapı sınırı                              = ${modelGate.maxConcurrent}`)
  console.log(`kapı son durumu                          = ${JSON.stringify(modelGate.snapshot())}`)

  console.log('\nzaman çizelgesi (göreli ms):')
  const t0 = Math.min(...result.recs.map((rec) => rec.start))
  for (const rec of result.recs) {
    const start = String(rec.start - t0).padStart(5)
    const end = rec.end !== undefined ? String(rec.end - t0).padStart(5) : '    -'
    const close = rec.close !== undefined ? String(rec.close - t0).padStart(5) : '    -'
    console.log(
      `  #${String(rec.id).padStart(2)} ${rec.tag.padEnd(5)} start=${start} end=${end} close=${close} ` +
        `${rec.aborted ? 'İPTAL' : 'tamam'}`
    )
  }

  const verdict =
    result.maxCompleted <= modelGate.maxConcurrent
      ? 'A) ölçüm hatası: tamamlanan istekler sınırı aşmadı; iptal edilenler TCP düzeyinde sayılıyordu'
      : 'B) GERÇEK KAPI HATASI: tamamlanan istekler de sınırı aştı'
  console.log(`\nKARAR: ${verdict}\n`)

  app.exit(0)
})
