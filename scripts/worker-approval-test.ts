/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { AgentProcess } from '../src/main/agent/process'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { resolveApproval } from '../src/main/agent/approval'
import { resolveQuestion } from '../src/main/agent/question'
import { getSettings } from '../src/main/settings'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * İşçide onay ve soru köprüsü testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/worker-approval-test.ts
 *
 * Güvenlik iddiası: onay atlanamaz. Kullanıcı yanıt vermezse eylem
 * gerçekleşmez; yanıt verirse gerçekleşir ve yanıt gerçekten kullanıcıdan
 * gelmiş olur (işçi kendi kendine onay veremez).
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

function makeServer(script: (round: number) => string[]) {
  let round = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      round += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const part of script(round)) response.write(part)
      response.end()
    })
  })
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

function deleteToolRound(): string[] {
  return [
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-del',
                function: { name: 'delete_file', arguments: '{"path":"silinecek.txt"}' }
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

function textRound(text: string): string[] {
  return [
    sse({ choices: [{ delta: { content: text } }] }),
    sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n'
  ]
}

app.whenReady().then(async () => {
  const workerPath = join(process.cwd(), 'out', 'main', 'agentWorker.js')
  const base = join(process.env.EVREN_TEST_DATA as string, 'approval-ws')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const settings = await getSettings()

  const agent = new AgentProcess({ modulePath: workerPath, startTimeoutMs: 20_000 })
  await agent.start()

  const payload = (mode: 'confirm' | 'auto'): ChatRequest =>
    ({
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
      agent: {
        enabled: true,
        mode,
        profile: 'build',
        browser: false,
        computer: false,
        workspace: true
      }
    }) as ChatRequest

  // ===== 1) onay isteği kullanıcıya ulaşıyor ve reddedilebiliyor =====
  {
    const target = join(base, 'silinecek.txt')
    const { writeFileSync } = await import('fs')
    writeFileSync(target, 'x', 'utf8')

    const { server, port } = await makeServer((round) =>
      round === 1 ? deleteToolRound() : textRound('tamam')
    )
    const sink = createRecordingSink()

    const run = agent.runAgentInWorker(
      {
        requestId: 'ap-reject',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payload('confirm'),
        settings,
        workspaceRoot: base
      },
      sink
    )

    // Onay olayını bekle, sonra reddet.
    let approvalEvent: ChatEvent | undefined
    for (let index = 0; index < 60 && !approvalEvent; index++) {
      await sleep(100)
      approvalEvent = sink.events.find((event) => event.type === 'approval')
    }
    check('onay olayı kullanıcıya ulaştı', !!approvalEvent, true)
    const request = (approvalEvent as { request: { toolCallId: string; requestId: string } })
      .request
    check('onay isteği araç kimliği taşır', request.toolCallId, 'call-del')

    resolveApproval(`${request.requestId}::${request.toolCallId}`, false)
    const result = await run
    server.close()

    check('koşu tamamlandı', result.ok, true)
    const toolResult = sink.events.find((event) => event.type === 'tool-result') as
      | { result: { ok: boolean; content: string } }
      | undefined
    check('reddedilen araç başarısız', toolResult?.result.ok, false)
    check('red mesajı', toolResult?.result.content.includes('reddetti'), true)
    check('dosya silinmedi', existsSync(target), true)
  }

  // ===== 2) onay verilirse eylem gerçekleşir =====
  {
    const target = join(base, 'silinecek2.txt')
    const { writeFileSync } = await import('fs')
    writeFileSync(target, 'x', 'utf8')

    const { server, port } = await makeServer((round) =>
      round === 1
        ? [
            sse({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-del2',
                        function: { name: 'delete_file', arguments: '{"path":"silinecek2.txt"}' }
                      }
                    ]
                  }
                }
              ]
            }),
            sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
            'data: [DONE]\n\n'
          ]
        : textRound('silindi')
    )
    const sink = createRecordingSink()

    const run = agent.runAgentInWorker(
      {
        requestId: 'ap-allow',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payload('confirm'),
        settings,
        workspaceRoot: base
      },
      sink
    )

    let approvalEvent: ChatEvent | undefined
    for (let index = 0; index < 60 && !approvalEvent; index++) {
      await sleep(100)
      approvalEvent = sink.events.find((event) => event.type === 'approval')
    }
    const request = (approvalEvent as { request: { toolCallId: string; requestId: string } })
      .request
    resolveApproval(`${request.requestId}::${request.toolCallId}`, true)
    const result = await run
    server.close()

    check('onaylı koşu tamamlandı', result.ok, true)
    check('dosya silindi', existsSync(target), false)
  }

  // ===== 3) yanıt gelmezse eylem gerçekleşmez (kilitlenme yok) =====
  {
    const target = join(base, 'silinecek3.txt')
    const { writeFileSync } = await import('fs')
    writeFileSync(target, 'x', 'utf8')

    const { server, port } = await makeServer((round) =>
      round === 1
        ? [
            sse({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-del3',
                        function: { name: 'delete_file', arguments: '{"path":"silinecek3.txt"}' }
                      }
                    ]
                  }
                }
              ]
            }),
            sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
            'data: [DONE]\n\n'
          ]
        : textRound('bitti')
    )
    const sink = createRecordingSink()

    const run = agent.runAgentInWorker(
      {
        requestId: 'ap-cancel',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payload('confirm'),
        settings,
        workspaceRoot: base
      },
      sink
    )

    // Onay isteğini yanıtsız bırak ve koşuyu iptal et.
    let sawApproval = false
    for (let index = 0; index < 60 && !sawApproval; index++) {
      await sleep(100)
      sawApproval = sink.events.some((event) => event.type === 'approval')
    }
    check('onay istendi', sawApproval, true)
    await agent.cancelInWorker('ap-cancel')
    const result = await run
    server.close()

    check('iptal sonrası koşu biter', result.ok, true)
    check('dosya korunur (onaysız silinmez)', existsSync(target), true)
  }

  // ===== 4) soru köprüsü =====
  {
    const { server, port } = await makeServer((round) =>
      round === 1
        ? [
            sse({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-q',
                        function: {
                          name: 'question',
                          arguments: '{"question":"Hangi renk?","options":["kırmızı","mavi"]}'
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
        : textRound('teşekkürler')
    )
    const sink = createRecordingSink()

    const run = agent.runAgentInWorker(
      {
        requestId: 'q-1',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload: payload('auto'),
        settings,
        workspaceRoot: base
      },
      sink
    )

    let questionEvent: ChatEvent | undefined
    for (let index = 0; index < 60 && !questionEvent; index++) {
      await sleep(100)
      questionEvent = sink.events.find((event) => event.type === 'question')
    }
    check('soru olayı kullanıcıya ulaştı', !!questionEvent, true)
    const questionRequest = (
      questionEvent as { request: { requestId: string; question: { id: string } } }
    ).request
    resolveQuestion(questionRequest.requestId, questionRequest.question.id, ['mavi'])

    const result = await run
    server.close()
    check('soru sonrası koşu tamamlandı', result.ok, true)
    const toolResult = sink.events.find((event) => event.type === 'tool-result') as
      | { result: { ok: boolean; content: string } }
      | undefined
    check('araç yanıtı aldı', toolResult?.result.ok, true)
    check('yanıt içeriğe yansıdı', toolResult?.result.content.includes('mavi'), true)
  }

  await agent.stop()

  console.log(`TOTAL=16 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
