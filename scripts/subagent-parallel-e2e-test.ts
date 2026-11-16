/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { performanceProfile } from '../src/main/agent/hardwareProfile'
import { runWithWorkspace } from '../src/main/workspace'
import type { ToolCallInfo } from '../src/shared/types'

/**
 * Alt ajan içi paralel araç + ön okuma kanıtı.
 * Çalıştırma: node scripts/run-unit.cjs scripts/subagent-parallel-e2e-test.ts
 *
 * ## Neden
 *
 * 0.4.20 ölçümü: en yavaş ajanlar 20 adımda araçları **sırayla** çalıştırıyordu
 * (`for (const call of result.toolCalls)`), ve her ajan "listele → oku" turlarını
 * kendi harcıyordu. İki düzeltme burada:
 *
 * 1. **Paralel araç:** salt-okunur çağrılar eşzamanlı (donanım profiline göre).
 * 2. **Ön okuma (warm start):** istemde adı geçen dosyalar ajan başlamadan
 *    okunup bağlama konur → model 2-5 adım kazanır.
 *
 * Test sahte sağlayıcıyla: ilk adımda 3 `read_file` ister, ikinci adımda biter.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
process.env['EVREN_SUBAGENT_LOG_DIR'] = join(dataDir, 'logs')
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

let round = 0
/** İlk isteğin mesajları (ön okuma kontrolü için). */
let firstRequestMessages: Array<{ role?: string; content?: unknown }> = []

function startModelServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      if (round === 0) firstRequestMessages = messages
      const toolMessages = messages.filter((message) => message.role === 'tool').length
      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (round === 0) {
        round += 1
        const calls = ['a.txt', 'b.txt', 'c.txt'].map((file, index) => ({
          index,
          id: `r-${index}`,
          function: { name: 'read_file', arguments: JSON.stringify({ path: file }) }
        }))
        response.write(sse({ choices: [{ delta: { tool_calls: calls } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      response.write(sse({ choices: [{ delta: { content: `Bitti (${toolMessages} araç).` } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

app.whenReady().then(async () => {
  const perf = performanceProfile()
  console.log(`profil: ${perf.tier} · araç paralelliği ${perf.toolParallelism}`)

  const base = join(dataDir, 'sub-parallel')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const big = `${'satır '.repeat(200)}\n`
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
    writeFileSync(join(base, name), `${name}\n${big}`, 'utf8')
  }

  const model = await startModelServer()
  const toolCalls: ToolCallInfo[] = []

  const result = await runWithWorkspace(base, () =>
    runSubagent({
      parentRequestId: 'req-sub-parallel',
      baseUrl: `http://127.0.0.1:${model.port}`,
      apiKey: 'test',
      model: 'sub-model',
      agentType: 'explore',
      // İstemde d.txt adı geçiyor → ön okumaya aday.
      prompt: 'a.txt, b.txt ve c.txt dosyalarını oku. d.txt dosyasını da dikkate al.',
      workspaceRoot: base,
      mode: 'auto',
      profile: 'build',
      controller: new AbortController(),
      send: (event) => {
        if (event.type === 'tool-call') toolCalls.push(event.call)
      },
      subagentTaskId: 'sub-parallel-probe',
      description: 'paralel + ön okuma'
    })
  )
  model.server.close()

  const prefetchMessages = firstRequestMessages.filter((message) =>
    String(message.content ?? '').startsWith('ÖN OKUMA:')
  )
  const prefetchNote = firstRequestMessages.some((message) =>
    String(message.content ?? '').includes('Bu dosyaları **tekrar okumaya çalışma**')
  )
  const prefetchCalls = toolCalls.filter((call) => call.id.startsWith('prefetch-'))

  console.log(
    `\nön okuma: ${prefetchMessages.length} dosya · not eklendi: ${prefetchNote} · ` +
      `sonuç ${result.content.length} kr · kısmi=${result.partial ?? false}`
  )

  check('alt ajan tamamlandı', result.ok, true)
  check('kısmi değil', result.partial ?? false, false)

  // ===== ön okuma =====
  check('ön okuma yapıldı', prefetchMessages.length >= 3, true)
  check('ön okumada d.txt var', prefetchMessages.some((m) => String(m.content).includes('ÖN OKUMA: d.txt')), true)
  check('isteğe tekrar-okuma notu eklendi', prefetchNote, true)
  check(
    'ön okuma araç çağrısı olarak yayınlandı',
    prefetchCalls.length >= 3,
    true
  )
  check(
    'ön okuma içeriği gerçekten geldi',
    prefetchMessages.some((message) => String(message.content).includes('satır')),
    true
  )

  // ===== paralel araç =====
  // Üç read_file tek adımda isteniyor; profil izin veriyorsa paralel koşmalı.
  const readCalls = toolCalls.filter((call) => call.name === 'read_file' && !call.id.startsWith('prefetch-'))
  check('üç read_file istendi', readCalls.length, 3)

  console.log(`TOTAL=8 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
