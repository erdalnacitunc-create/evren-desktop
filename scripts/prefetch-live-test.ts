/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatRequest, ToolResultInfo } from '../src/shared/types'

/**
 * Gerçek döngüde ön okuma (prefetch) kanıtı.
 * Çalıştırma: node scripts/run-unit.cjs scripts/prefetch-live-test.ts
 *
 * ## Neden
 *
 * 0.4.22 üç fazlı koşusunda ön okuma **0 ajan / 0 dosya** göründü. Sebep
 * ölçüm hatasıydı: test `EVREN_SUBAGENT_LOG_DIR`'i okuyor ama ayarlamıyordu.
 * Bu test ön okumanın **gerçek ajan yolunda** çalıştığını doğrular:
 *
 * 1. Ana ajan `spawn_agent` ile istemde dosya adı veriyor.
 * 2. Alt ajan başlamadan önce o dosyalar okunup bağlama konuyor.
 * 3. Bunlar `tool-call` olayı olarak yayınlanıyor (`prefetch-*` kimlikleriyle).
 * 4. İlk model isteğinde "ÖN OKUMA:" iletileri bulunuyor.
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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let mainRound = 0
let subagentRequests = 0
const subagentFirstMessages: string[][] = []

function startModelServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const systemText = messages
        .filter((m) => m.role === 'system')
        .map((m) => String(m.content ?? ''))
        .join('\n')
      const isSubagent = /alt ajan[ıi]s[ıi]n/i.test(systemText)
      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (isSubagent) {
        subagentRequests += 1
        if (subagentRequests === 1) {
          subagentFirstMessages.push(messages.map((m) => String(m.content ?? '')))
        }
        response.write(sse({ choices: [{ delta: { content: 'İnceledim, bulgular hazır.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      mainRound += 1
      if (mainRound === 1) {
        // Ana ajan: istemde iki dosya adı geçen bir explore ajanı başlatır.
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'spawn-1',
                      function: {
                        name: 'spawn_agent',
                        arguments: JSON.stringify({
                          agent: 'explore',
                          prompt:
                            'src/alpha.ts ve src/beta.ts dosyalarını oku, ' +
                            'her birinin ne yaptığını tek cümleyle söyle.',
                          background: true,
                          description: 'iki dosya'
                        })
                      }
                    }
                  ]
                }
              }
            ]
          })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      response.write(sse({ choices: [{ delta: { content: 'Bitti.' } }] }))
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
  const base = join(dataDir, 'prefetch-live')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src'), { recursive: true })
  writeFileSync(
    join(base, 'src', 'alpha.ts'),
    'export function alpha(): string {\n  return "ALFA-ICERIK"\n}\n',
    'utf8'
  )
  writeFileSync(
    join(base, 'src', 'beta.ts'),
    'export function beta(): number {\n  return 42 // BETA-ICERIK\n}\n',
    'utf8'
  )

  const settings = await getSettings()
  const model = await startModelServer()
  const sink = createRecordingSink()

  const payload = {
    model: 'prefetch-model',
    messages: [{ role: 'user', content: 'İki dosyayı incele.' }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as ChatRequest

  await runWithWorkspace(base, () =>
    runAgent({
      requestId: 'req-prefetch-live',
      webContentsId: 0,
      baseUrl: `http://127.0.0.1:${model.port}`,
      apiKey: 'test',
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: base
    })
  )

  for (let index = 0; index < 60; index += 1) {
    const running = sink.events.filter(
      (event) =>
        event.type === 'subagent-task' &&
        (event as { task?: { status?: string } }).task?.status === 'running'
    ).length
    if (running === 0) break
    await sleep(100)
  }
  await sleep(300)
  model.server.close()

  const toolCalls = sink.events
    .filter((event) => event.type === 'tool-call')
    .map((event) => (event as { call?: { id?: string; name?: string; arguments?: string } }).call)
    .filter((call): call is { id?: string; name?: string; arguments?: string } => Boolean(call))
  const prefetchCalls = toolCalls.filter((call) => String(call.id).startsWith('prefetch-'))

  const results = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => Boolean(result))

  const firstSubagent = subagentFirstMessages[0] ?? []
  const prefetchMessages = firstSubagent.filter((content) => content.startsWith('ÖN OKUMA:'))
  const hasNota = firstSubagent.some((content) => content.includes('tekrar okumaya çalışma'))

  console.log(`\nön okuma çağrısı: ${prefetchCalls.length}`)
  console.log(`alt ajana giden ön okuma iletisi: ${prefetchMessages.length}`)
  console.log(`istemde tekrar-okuma notu: ${hasNota}`)
  console.log(
    `dosyalar: ${prefetchCalls.map((call) => String(call.arguments).slice(0, 60)).join(' | ')}`
  )

  // ===== iddialar =====
  check('alt ajan başladı', subagentRequests >= 1, true)
  check('ön okuma araç çağrısı yayınlandı', prefetchCalls.length >= 2, true)
  check(
    'iki dosya da ön okundu',
    prefetchCalls.some((c) => String(c.arguments).includes('alpha.ts')) &&
      prefetchCalls.some((c) => String(c.arguments).includes('beta.ts')),
    true
  )
  check('ön okuma iletileri alt ajana gitti', prefetchMessages.length >= 2, true)
  check(
    'gerçek dosya içeriği bağlamda',
    prefetchMessages.some((content) => content.includes('ALFA-ICERIK')),
    true
  )
  check('ikinci dosya içeriği de var', prefetchMessages.some((content) => content.includes('BETA-ICERIK')), true)
  check('istemde tekrar-okuma notu var', hasNota, true)
  check(
    'ön okuma sonuçları arayüze yansıdı',
    results.some((result) => String(result.content).startsWith('ÖN OKUMA:')),
    true
  )

  console.log(`\nTOTAL=8 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
