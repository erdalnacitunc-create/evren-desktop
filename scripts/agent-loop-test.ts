/// <reference types="node" />
import { app } from 'electron'
import { createServer, type Server } from 'http'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { pushSteering, clearAllSteering } from '../src/main/agent/steering'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * Ajan döngüsü uçtan uca testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-loop-test.ts
 *
 * Gerçek API yerine yerel bir SSE sunucusu kullanılır; böylece üretim kodu
 * değişmeden döngü, araç çağrısı, onay, iptal ve steering davranışı sınanır.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`
const textChunk = (text: string): string => sse({ choices: [{ delta: { content: text } }] })

type Script = (body: string) => string[]

/** İstek gövdesine göre bir yanıt dizisi üretir; her çağrı tüketir. */
function makeServer(
  script: Script,
  options: { keepOpen?: boolean } = {}
): Promise<{ server: Server; port: number; calls: string[] }> {
  const calls: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      calls.push(body)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache'
      })
      for (const part of script(body)) response.write(part)
      // keepOpen: akışı kapatma; istemci iptal edene kadar bekle.
      if (!options.keepOpen) response.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port, calls })
    })
  })
}

function payloadFor(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'merhaba' }],
    agent: { enabled: true, mode: 'auto', profile: 'build', browser: false, computer: false, workspace: true },
    ...overrides
  } as ChatRequest
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'agent-ws')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })

  // ===== 1) düz metin yanıtı =====
  {
    const { server, port, calls } = await makeServer(() => [
      textChunk('Mer'),
      textChunk('haba'),
      sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
      'data: [DONE]\n\n'
    ])
    const sink = createRecordingSink()
    const controller = new AbortController()
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'r-text',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payloadFor(),
        controller,
        sink
      })
    )
    server.close()

    const contents = sink.events.filter((e) => e.type === 'content').map((e) => (e as { text: string }).text)
    check('metin parçaları akar', contents, ['Mer', 'haba'])
    check('tek done olayı', sink.countOf('done'), 1)
    check('done finishReason', (sink.events.find((e) => e.type === 'done') as { finishReason: string }).finishReason, 'stop')
    check('usage iletilir', sink.countOf('usage'), 1)
    check('olaylar istek kimliğini taşır', sink.events.every((e) => e.requestId === 'r-text'), true)
    check('sunucuya bir istek gitti', calls.length, 1)
    check('sistem mesajı eklendi', calls[0].includes('EVREN Desktop masaüstü ajanısın'), true)
  }

  // ===== 2) araç çağrısı ve sonuç =====
  {
    let round = 0
    const { server, port, calls } = await makeServer(() => {
      round += 1
      if (round === 1) {
        return [
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: { name: 'write_file', arguments: '{"path":"a.txt","content":"merhaba"}' }
                    }
                  ]
                }
              }
            ]
          }),
          sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n'
        ]
      }
      return [textChunk('Dosya yazıldı.'), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']
    })

    const sink = createRecordingSink()
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'r-tool',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payloadFor(),
        controller: new AbortController(),
        sink
      })
    )
    server.close()

    check('araç çağrısı olayı', sink.countOf('tool-call'), 1)
    check('araç sonucu olayı', sink.countOf('tool-result'), 1)
    const result = sink.events.find((e) => e.type === 'tool-result') as {
      result: { ok: boolean; name: string }
    }
    check('araç başarılı', result.result.ok, true)
    check('araç adı', result.result.name, 'write_file')
    const file = join(base, 'a.txt')
    check('dosya gerçekten yazıldı', existsSync(file), true)
    check('dosya içeriği', readFileSync(file, 'utf8'), 'merhaba')
    check('ikinci istek araç sonucunu taşır', calls[1].includes('merhaba'), true)
    check('done en sonda', sink.events[sink.events.length - 1]?.type, 'done')
  }

  // ===== 3) onay isteği ve reddetme =====
  {
    let round = 0
    const { server, port } = await makeServer(() => {
      round += 1
      if (round === 1) {
        return [
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-del',
                      function: { name: 'delete_file', arguments: '{"path":"yok.txt"}' }
                    }
                  ]
                }
              }
            ]
          }),
          sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n'
        ]
      }
      return [textChunk('Tamam.'), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']
    })

    const sink = createRecordingSink()
    // Onay isteği yalnızca 'confirm' modunda üretilir.
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'r-approval',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payloadFor({
          agent: {
            enabled: true,
            mode: 'confirm',
            profile: 'build',
            browser: false,
            computer: false,
            workspace: true
          }
        } as never),
        controller: new AbortController(),
        sink,
        approval: async () => false
      })
    )
    server.close()

    check('reddedilen araç sonucu', sink.countOf('tool-result'), 1)
    const rejected = sink.events.find((e) => e.type === 'tool-result') as {
      result: { ok: boolean; content: string }
    }
    check('araç çalışmadı', rejected.result.ok, false)
    check('red mesajı', rejected.result.content.includes('reddetti'), true)
  }

  // ===== 4) iptal (abort) =====
  {
    // Akış açık tutulur: istemci iptal edene kadar yanıt bitmez.
    const { server, port } = await makeServer(() => [textChunk('başladı')], { keepOpen: true })
    const sink = createRecordingSink()
    const controller = new AbortController()
    const run = runWithWorkspace(base, () =>
      runAgent({
        requestId: 'r-abort',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payloadFor(),
        controller,
        sink
      })
    )
    await sleep(250)
    controller.abort()
    await run
    server.closeAllConnections?.()
    server.close()
    check('iptal sonrası done', sink.countOf('done'), 1)
    check(
      'iptal nedeni',
      (sink.events.find((e) => e.type === 'done') as { finishReason: string }).finishReason,
      'aborted'
    )
    check('iptalde hata olayı yok', sink.countOf('error'), 0)
  }

  // ===== 5) steering: adım sınırında iletilir =====
  {
    let round = 0
    const { server, port, calls } = await makeServer(() => {
      round += 1
      if (round === 1) {
        return [
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-w1',
                      function: { name: 'write_file', arguments: '{"path":"s1.txt","content":"1"}' }
                    }
                  ]
                }
              }
            ]
          }),
          sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n'
        ]
      }
      return [textChunk('Bitti.'), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']
    })

    const sink = createRecordingSink()
    clearAllSteering()
    pushSteering('r-steer', 'ek talimat')
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'r-steer',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payloadFor(),
        controller: new AbortController(),
        sink
      })
    )
    server.close()

    check('steering olayı yayınlandı', sink.countOf('steering'), 1)
    check('steering metni', (sink.events.find((e) => e.type === 'steering') as { text: string }).text, 'ek talimat')
    check('ikinci istekte kullanıcı mesajı var', calls[1].includes('ek talimat'), true)
    check('done en sonda (steering sonrası)', sink.events[sink.events.length - 1]?.type, 'done')
    clearAllSteering()
  }

  // ===== 6) HTTP hatası =====
  {
    const server = createServer((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'kota aşıldı' } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const sink = createRecordingSink()
    await runWithWorkspace(base, () =>
      runAgent({
        requestId: 'r-error',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payloadFor(),
        controller: new AbortController(),
        sink
      })
    )
    server.close()

    check('hata olayı', sink.countOf('error'), 1)
    const errorEvent = sink.events.find((e) => e.type === 'error') as { error: string; status?: number }
    check('hata mesajı taşınır', errorEvent.error.includes('kota'), true)
    check('durum kodu taşınır', errorEvent.status, 429)
    check('hatadan sonra done yok', sink.countOf('done'), 0)
  }

  console.log(`TOTAL=28 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
