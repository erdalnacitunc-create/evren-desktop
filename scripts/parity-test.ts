/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { useWorkerForAgent } from '../src/main/chat'
import { AgentProcess } from '../src/main/agent/process'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runAgent } from '../src/main/agent/loop'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * Ana süreç (in-process) ile işçi süreci aynı olay dizisini üretiyor mu?
 * Çalıştırma: node scripts/run-unit.cjs scripts/parity-test.ts
 *
 * Amaç: devretmenin davranışı değiştirmediğini kanıtlamak. Aynı senaryo iki
 * yolda koşar; olay türleri ve içerikleri karşılaştırılır.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

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

/** Senaryo: araç çağrısı + metin. Her iki yol da bu diziyi üretmeli. */
function script(round: number): string[] {
  if (round === 1) {
    return [
      sse({ choices: [{ delta: { content: 'Dosyayı yazıyorum. ' } }] }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-parity',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"parity.txt","content":"içerik"}'
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
    sse({ choices: [{ delta: { content: 'Tamamlandı.' } }] }),
    sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n'
  ]
}

function describe(events: ChatEvent[]): {
  types: string[]
  text: string
  toolOk: boolean | null
  finish: string | null
} {
  return {
    types: events.map((event) => event.type),
    text: events
      .filter((event) => event.type === 'content')
      .map((event) => (event as { text: string }).text)
      .join(''),
    toolOk:
      (events.find((event) => event.type === 'tool-result') as
        | { result: { ok: boolean } }
        | undefined)?.result.ok ?? null,
    finish:
      (events.find((event) => event.type === 'done') as { finishReason: string } | undefined)
        ?.finishReason ?? null
  }
}

function payload(): ChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'yaz' }],
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
  const base = join(process.env.EVREN_TEST_DATA as string, 'parity')
  const dirLocal = join(base, 'local')
  const dirWorker = join(base, 'worker')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(dirLocal, { recursive: true })
  mkdirSync(dirWorker, { recursive: true })
  const settings = await getSettings()

  // ===== ana süreç =====
  const serverA = await makeServer(script)
  const sinkLocal = createRecordingSink()
  await runWithWorkspace(dirLocal, () =>
    runAgent({
      requestId: 'parity-local',
      webContentsId: 0,
      baseUrl: `http://127.0.0.1:${serverA.port}`,
      apiKey: 'test',
      payload: payload(),
      controller: new AbortController(),
      sink: sinkLocal,
      settings,
      workspaceRoot: dirLocal
    })
  )
  serverA.server.close()

  // ===== işçi süreç =====
  const serverB = await makeServer(script)
  const agent = new AgentProcess({
    modulePath: process.env['EVREN_AGENT_WORKER'] ?? join(process.cwd(), 'out', 'main', 'agentWorker.js'),
    startTimeoutMs: 20_000
  })
  const sinkWorker = createRecordingSink()
  await agent.runAgentInWorker(
    {
      requestId: 'parity-worker',
      baseUrl: `http://127.0.0.1:${serverB.port}`,
      apiKey: 'test',
      payload: payload(),
      settings,
      workspaceRoot: dirWorker
    },
    sinkWorker
  )
  serverB.server.close()
  await agent.stop()

  const local = describe(sinkLocal.events)
  const worker = describe(sinkWorker.events)

  check('olay türleri aynı', worker.types, local.types)
  check('metin aynı', worker.text, local.text)
  check('araç sonucu aynı', worker.toolOk, local.toolOk)
  check('bitiş nedeni aynı', worker.finish, local.finish)
  check('araç başarılı (yerel)', local.toolOk, true)
  check('araç başarılı (işçi)', worker.toolOk, true)
  check('metin beklenen (yerel)', local.text, 'Dosyayı yazıyorum. Tamamlandı.')
  check('metin beklenen (işçi)', worker.text, 'Dosyayı yazıyorum. Tamamlandı.')

  check('bayrak varsayılan olarak kapalı', process.env['EVREN_AGENT_PROCESS'], undefined)
  check('bayrak okunur', typeof useWorkerForAgent(), 'boolean')

  console.log(`TOTAL=10 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
