/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * Paralel koşularda bekleyen istek.
 * Çalıştırma: node scripts/run-unit.cjs scripts/parallel-hang-test.ts
 *
 * Gerçek olay: aynı sorgu iki sekmede paralel başlatıldı; sağlayıcı birini
 * yanıtladı, diğeri hiç veri almadan sonsuza kadar bekledi. Bu test, bekleyen
 * koşunun hata ile kapanmasını ve diğerini etkilememesini doğrular.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)
process.env['EVREN_STREAM_IDLE_MS'] = '500'

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

/** İlk isteği yanıtlar, sonraki istekleri sessizce bekletir. */
function startServer() {
  let requests = 0
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests += 1
      if (requests === 1) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(sse({ choices: [{ delta: { content: 'BİRİNCİ YANIT' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }
      // Sessiz: bağlantı açık kalır, hiçbir bayt gönderilmez.
    })
  })
  return new Promise<{ server: typeof server; port: number; count: () => number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        count: () => requests
      })
    })
  })
}

function payload(text: string): ChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: text }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as ChatRequest
}

const contentOf = (events: ChatEvent[]): string =>
  events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'parallel')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const settings = await getSettings()

  const { server, port, count } = await startServer()

  const sinkA = createRecordingSink()
  const sinkB = createRecordingSink()
  const started = Date.now()

  const runOne = (requestId: string, sink: ReturnType<typeof createRecordingSink>, text: string) =>
    runWithWorkspace(base, () =>
      runAgent({
        requestId,
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payload(text),
        controller: new AbortController(),
        sink,
        settings,
        workspaceRoot: base
      })
    )

  // A önce başlar (yanıtlanır), B sonra (bekletilir).
  const a = runOne('par-A', sinkA, 'sorgu A')
  await new Promise((resolve) => setTimeout(resolve, 150))
  const b = runOne('par-B', sinkB, 'sorgu B')

  await Promise.all([a, b])
  const elapsed = Date.now() - started
  server.close()

  // ===== yanıtlanan koşu =====
  check('A yanıtı geldi', contentOf(sinkA.events), 'BİRİNCİ YANIT')
  check('A tek done', sinkA.countOf('done'), 1)
  check('A hata almadı', sinkA.countOf('error'), 0)
  check('A olayları kendi kimliğinde', sinkA.events.every((e) => e.requestId === 'par-A'), true)

  // ===== bekletilen koşu =====
  check('B sonsuza kadar beklemedi', elapsed < 15_000, true)
  check('B hata olayı üretti', sinkB.countOf('error'), 1)
  const errorEvent = sinkB.events.find((e) => e.type === 'error') as { error: string } | undefined
  check('B hata mesajı açıklayıcı', (errorEvent?.error ?? '').length > 0, true)
  check('B olayları kendi kimliğinde', sinkB.events.every((e) => e.requestId === 'par-B'), true)
  check('B done üretmedi (hata yeterli)', sinkB.countOf('done'), 0)

  // ===== karışma yok =====
  check('A içeriği B ye sızmadı', contentOf(sinkB.events), '')
  check(
    'sunucuya iki (A) + deneme (B) istekleri gitti',
    count() >= 2,
    true
  )

  console.log(`TOTAL=12 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
