/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { CONTINUE_AFTER_INCOMPLETE } from '../src/main/ai/continuation'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * Devam ettirme (continuation) testleri — OpenCode `Outcome.Continue` parity.
 * Çalıştırma: node scripts/run-unit.cjs scripts/continuation-test.ts
 *
 * İddia: akış ortada kesilirse kullanıcı yarım yanıtla kalmaz; metin korunur
 * ve model kaldığı yerden devam eder.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface Stats {
  requests: number
  sawContinuePrompt: boolean
  lastBody: string
}

/** 1. istek: kısmi metin gönderip bağlantıyı koparır. 2. istek: tamamlar. */
function startServer(mode: 'interrupt-then-ok' | 'length-then-ok' | 'always-interrupt') {
  const stats: Stats = { requests: 0, sawContinuePrompt: false, lastBody: '' }
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      stats.requests += 1
      stats.lastBody = body
      if (body.includes('Önceki yanıt kesildi') || body.includes('çıktı token sınırına')) {
        stats.sawContinuePrompt = true
      }

      const isFirst = stats.requests === 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (mode === 'length-then-ok') {
        if (isFirst) {
          response.write(sse({ choices: [{ delta: { content: 'YARIM ' } }] }))
          response.write(sse({ choices: [{ delta: {}, finish_reason: 'length' }] }))
          response.write('data: [DONE]\n\n')
          response.end()
          return
        }
        response.write(sse({ choices: [{ delta: { content: 'DEVAM' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }

      // interrupt-then-ok / always-interrupt
      response.write(sse({ choices: [{ delta: { content: 'BAŞLANGIÇ ' } }] }))
      if (isFirst || mode === 'always-interrupt') {
        // Kısmi metin gönderdikten sonra bağlantıyı kopar.
        setTimeout(() => response.destroy(), 120)
        return
      }
      response.write(sse({ choices: [{ delta: { content: 'SON' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  return new Promise<{ server: typeof server; port: number; stats: Stats }>((resolve) => {
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

function payload(): ChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'uzun cevap yaz' }],
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
  const base = join(process.env.EVREN_TEST_DATA as string, 'continuation')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const settings = await getSettings()

  const run = async (port: number, sink: ReturnType<typeof createRecordingSink>) => {
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'cont-1',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payload(),
        controller: new AbortController(),
        sink,
        settings,
        workspaceRoot: base
      })
    )
  }

  // ===== 1) akış kesilir → devam eder =====
  {
    const { server, port, stats } = await startServer('interrupt-then-ok')
    const sink = createRecordingSink()
    const started = Date.now()
    await run(port, sink)
    server.close()

    const text = contentOf(sink.events)
    check('kesilen akış devam etti', text.includes('SON'), true)
    check('ilk kısmi metin korundu', text.includes('BAŞLANGIÇ'), true)
    check('metin birleşti', text, 'BAŞLANGIÇ BAŞLANGIÇ SON')
    check('continue olayı yayınlandı', sink.countOf('continue'), 1)
    check('devam istemi gönderildi', stats.sawContinuePrompt, true)
    check('iki istek yapıldı', stats.requests, 2)
    check('hata olayı yok', sink.countOf('error'), 0)
    check('tek done', sink.countOf('done'), 1)
    check('makul sürede bitti', Date.now() - started < 20_000, true)
    const cont = sink.events.find((e) => e.type === 'continue') as
      | { reason: string; attempt: number }
      | undefined
    check('devam nedeni interrupted', cont?.reason, 'interrupted')
    check('devam denemesi 1', cont?.attempt, 1)
  }

  // ===== 2) token limiti → devam eder =====
  {
    const { server, port, stats } = await startServer('length-then-ok')
    const sink = createRecordingSink()
    await run(port, sink)
    server.close()

    const text = contentOf(sink.events)
    check('limit sonrası devam etti', text, 'YARIM DEVAM')
    check('continue olayı (limit)', sink.countOf('continue'), 1)
    check('limit istemi gönderildi', stats.sawContinuePrompt, true)
    check('iki istek (limit)', stats.requests, 2)
    const cont = sink.events.find((e) => e.type === 'continue') as { reason: string } | undefined
    check('devam nedeni output-limit', cont?.reason, 'output-limit')
  }

  // ===== 3) sürekli kesilirse devam sınırında durur =====
  {
    const { server, port, stats } = await startServer('always-interrupt')
    const sink = createRecordingSink()
    await run(port, sink)
    server.close()
    server.closeAllConnections?.()

    check('devam sınırında durdu', stats.requests <= 7, true)
    check('sonunda hata bildirildi', sink.countOf('error') + sink.countOf('done') >= 1, true)
    check('sonsuz döngüye girmedi', stats.requests < 15, true)
  }

  console.log(`TOTAL=20 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
