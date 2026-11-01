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
 * Adım sınırı davranışı.
 * Çalıştırma: node scripts/run-unit.cjs scripts/max-steps-test.ts
 *
 * Gerçek olay: model 20 adım boyunca yalnızca araç çağırıp tek karakter
 * yanıt üretmedi ve kullanıcı boş ekranla kaldı. Artık sınıra ulaşınca
 * araçsız bir tur atılıp nihai yanıt isteniyor.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface ServerStats {
  requests: number
  toolRounds: number
  finalRounds: number
  sawEmptyTools: boolean
}

/** Her istekte araç çağrısı döner; araç listesi boşsa metin döner. */
function startServer(mode: 'text-after-limit' | 'empty-even-after-limit') {
  const stats: ServerStats = { requests: 0, toolRounds: 0, finalRounds: 0, sawEmptyTools: false }
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      stats.requests += 1
      const noTools = /"tools"\s*:\s*\[\s*\]/.test(body) || !/"tools"\s*:/.test(body)
      if (noTools) {
        stats.sawEmptyTools = true
        stats.finalRounds += 1
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        if (mode === 'text-after-limit') {
          response.write(sse({ choices: [{ delta: { content: 'NİHAİ YANIT' } }] }))
        }
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }

      stats.toolRounds += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${stats.toolRounds}`,
                    function: { name: 'list_files', arguments: '{}' }
                  }
                ]
              }
            }
          ]
        })
      )
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  return new Promise<{ server: typeof server; port: number; stats: ServerStats }>((resolve) => {
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
    messages: [{ role: 'user', content: 'usb tara' }],
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

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'max-steps')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const settings = await getSettings()

  const run = async (port: number, sink: ReturnType<typeof createRecordingSink>) => {
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'max-1',
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

  const contentOf = (events: ChatEvent[]): string =>
    events
      .filter((event) => event.type === 'content')
      .map((event) => (event as { text: string }).text)
      .join('')

  // ===== 1) model araçsız turda yanıt yazıyor =====
  {
    const { server, port, stats } = await startServer('text-after-limit')
    const sink = createRecordingSink()
    await run(port, sink)
    server.close()

    check('adım sınırında araçsız tur istendi', stats.sawEmptyTools, true)
    check('20 araç turu + 1 final turu', stats.requests, 21)
    check('nihai yanıt akıtıldı', contentOf(sink.events), 'NİHAİ YANIT')
    check('tek done olayı', sink.countOf('done'), 1)
    check(
      'bitiş nedeni max-steps',
      (sink.events.find((e) => e.type === 'done') as { finishReason: string }).finishReason,
      'max-steps'
    )
    check('kullanıcı boş kalmadı', contentOf(sink.events).length > 0, true)
  }

  // ===== 2) model yine boş dönerse özet yazılır =====
  {
    const { server, port } = await startServer('empty-even-after-limit')
    const sink = createRecordingSink()
    await run(port, sink)
    server.close()

    const text = contentOf(sink.events)
    check('özet metni üretildi', text.length > 0, true)
    check('özet sınırı açıklar', text.includes('Adım sınırına ulaştım'), true)
    check('özet araçları listeler', text.includes('list_files'), true)
    check('özet devam önerir', text.includes('devam et'), true)
    check('tek done olayı (özet)', sink.countOf('done'), 1)
  }

  console.log(`TOTAL=12 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
