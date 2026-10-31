/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { AgentProcess } from '../src/main/agent/process'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { getSettings } from '../src/main/settings'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * Ajanı işçi sürecinde çalıştırma testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/worker-agent-test.ts
 *
 * Ana süreç ile işçi arasındaki tam yolu sınar: istek, olay akışı, araç
 * çağrısı (dosya yazımı), iptal ve oturum yazımının ana süreçte kalması.
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

function makeServer(
  script: (body: string, round: number) => string[],
  options: { keepOpen?: boolean } = {}
) {
  let round = 0
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      round += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const part of script(body, round)) response.write(part)
      // keepOpen: istemci iptal edene kadar akışı açık tut.
      if (!options.keepOpen) response.end()
    })
  })
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

function agentPayload(): ChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'merhaba' }],
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
  const workerPath = join(process.cwd(), 'out', 'main', 'agentWorker.js')
  const base = join(process.env.EVREN_TEST_DATA as string, 'worker-agent')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const settings = await getSettings()

  const agent = new AgentProcess({ modulePath: workerPath, startTimeoutMs: 20_000 })
  await agent.start()

  // ===== 1) düz metin yanıtı işçiden akıyor =====
  {
    const { server, port } = await makeServer(() => [
      sse({ choices: [{ delta: { content: 'Mer' } }] }),
      sse({ choices: [{ delta: { content: 'haba' } }] }),
      sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n'
    ])

    const sink = createRecordingSink()
    const result = await agent.runAgentInWorker(
      {
        requestId: 'w-text',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: agentPayload(),
        settings,
        workspaceRoot: base
      },
      sink
    )
    server.close()

    check('istek başarılı', result.ok, true)
    const contents = sink.events
      .filter((event) => event.type === 'content')
      .map((event) => (event as { text: string }).text)
    check('metin parçaları akar', contents, ['Mer', 'haba'])
    check('tek done', sink.countOf('done'), 1)
    check('olaylar istek kimliğini taşır', sink.events.every((e) => e.requestId === 'w-text'), true)
  }

  // ===== 2) araç çağrısı işçide gerçek dosya yazıyor =====
  {
    const { server, port } = await makeServer((_body, round) => {
      if (round === 1) {
        return [
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-w',
                      function: {
                        name: 'write_file',
                        arguments: '{"path":"isci-test.txt","content":"işçiden"}'
                      }
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
      return [
        sse({ choices: [{ delta: { content: 'yazıldı' } }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n'
      ]
    })

    const sink = createRecordingSink()
    const result = await agent.runAgentInWorker(
      {
        requestId: 'w-tool',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: agentPayload(),
        settings,
        workspaceRoot: base
      },
      sink
    )
    server.close()

    check('araç isteği başarılı', result.ok, true)
    check('araç çağrısı olayı', sink.countOf('tool-call'), 1)
    check('araç sonucu olayı', sink.countOf('tool-result'), 1)
    const toolResult = sink.events.find((event) => event.type === 'tool-result') as
      | { result: { ok: boolean; content: string } }
      | undefined
    if (toolResult && !toolResult.result.ok) {
      console.log('    araç hatası: ' + toolResult.result.content.slice(0, 300))
    }
    check('araç başarılı', toolResult?.result.ok, true)
    const target = join(base, 'isci-test.txt')
    check('dosya işçi tarafından yazıldı', existsSync(target), true)
    check('dosya içeriği', readFileSync(target, 'utf8'), 'işçiden')
  }

  // ===== 3) işçi oturum deposunu uzaktan kullanıyor =====
  {
    const probe = await agent.sessionProbe()
    check('oturum erişimi çalışıyor', probe.ok, true)
  }

  // ===== 4) olay sızıntısı yok: iki istek ayrı sink =====
  {
    const { server, port } = await makeServer((body) => {
      const tag = /ETIKET:(\w+)/.exec(body)?.[1] ?? 'x'
      return [
        sse({ choices: [{ delta: { content: tag } }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n'
      ]
    })

    const sinkA = createRecordingSink()
    const sinkB = createRecordingSink()
    const payloadFor = (tag: string): ChatRequest =>
      ({
        model: 'test-model',
        messages: [{ role: 'user', content: `ETIKET:${tag}` }],
        agent: {
          enabled: true,
          mode: 'auto',
          profile: 'build',
          browser: false,
          computer: false,
          workspace: true
        }
      }) as ChatRequest

    await Promise.all([
      agent.runAgentInWorker(
        {
          requestId: 'iso-A',
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test',
          payload: payloadFor('A'),
          settings,
          workspaceRoot: base
        },
        sinkA
      ),
      agent.runAgentInWorker(
        {
          requestId: 'iso-B',
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test',
          payload: payloadFor('B'),
          settings,
          workspaceRoot: base
        },
        sinkB
      )
    ])
    server.close()

    check('A yalnızca A aldı', sinkA.events.every((e) => e.requestId === 'iso-A'), true)
    check('B yalnızca B aldı', sinkB.events.every((e) => e.requestId === 'iso-B'), true)
    const textA = sinkA.events.find((e) => e.type === 'content') as { text: string } | undefined
    const textB = sinkB.events.find((e) => e.type === 'content') as { text: string } | undefined
    check('A metni', textA?.text, 'A')
    check('B metni', textB?.text, 'B')
  }

  // ===== 5) iptal =====
  {
    const { server, port } = await makeServer(
      () => [sse({ choices: [{ delta: { content: 'başladı' } }] })],
      { keepOpen: true }
    )
    const sink = createRecordingSink()
    const run = agent.runAgentInWorker(
      {
        requestId: 'w-cancel',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: agentPayload(),
        settings,
        workspaceRoot: base
      },
      sink
    )
    await sleep(700)
    const cancelled = await agent.cancelInWorker('w-cancel')
    check('iptal kabul edildi', cancelled, true)
    const result = await run
    server.close()
    server.closeAllConnections?.()

    check('iptal sonrası istek biter', result.ok, true)
    check('iptal done olayı', sink.countOf('done'), 1)
    check(
      'iptal nedeni aborted',
      (sink.events.find((e) => e.type === 'done') as { finishReason: string }).finishReason,
      'aborted'
    )
  }

  // ===== 6) bilinmeyen istek iptali =====
  {
    check('olmayan istek iptali false', await agent.cancelInWorker('yok'), false)
  }

  await agent.stop()
  check('kapanış sonrası çalışmıyor', agent.status().running, false)

  console.log(`TOTAL=25 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
