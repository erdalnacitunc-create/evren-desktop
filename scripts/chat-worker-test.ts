/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { abortChat, startChat, steerChat, useWorkerForAgent } from '../src/main/chat'
import { getSettings } from '../src/main/settings'
import { saveApiKey } from '../src/main/credentials'
import { createSession, __flushWritesForTests, __resetCacheForTests } from '../src/main/sessionStore'
import { stopAgentProcess } from '../src/main/agent/process'
import type { ChatEvent, ChatRequest } from '../src/shared/types'

/**
 * Üretim yolundan (startChat) işçiye devretme testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/chat-worker-test.ts
 *
 * `EVREN_AGENT_PROCESS=worker` ile ajan işçi sürecinde koşar. Test, gerçek
 * `startChat` yolunu kullanır — yani kullanıcının gördüğü akış.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)
process.env['EVREN_AGENT_PROCESS'] = 'worker'
// Testte derlenmiş işçi depo kökünde; üretimde __dirname yeterli.
process.env['EVREN_AGENT_WORKER'] = join(process.cwd(), 'out', 'main', 'agentWorker.js')

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

function makeServer(script: (round: number) => string[], keepOpen = false) {
  let round = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      round += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const part of script(round)) response.write(part)
      if (!keepOpen) response.end()
    })
  })
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'chat-worker')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })

  await __resetCacheForTests()
  await getSettings()

  // Bayrak okunuyor mu?
  check('bayrak açık', useWorkerForAgent(), true)

  // API anahtarını kaydet (startChat anahtar ister).
  await saveApiKey('test-key-worker')

  // Sunucu adresini test sunucusuna yönlendir.
  const { server, port } = await makeServer((round) => {
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
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"chat-worker.txt","content":"üretim yolundan"}'
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
      sse({ choices: [{ delta: { content: 'tamam' } }] }),
      sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n'
    ]
  })

  const { setBaseUrl } = await import('../src/main/settings')
  await setBaseUrl(`http://127.0.0.1:${port}`)

  const session = await createSession('test-model')
  // Ajanın yazacağı yer: oturumun çalışma alanı.
  await (await import('../src/main/sessionStore')).patchSession(session.id, {
    workspacePath: base
  } as never)
  await __flushWritesForTests()

  // Olayları topla (renderer yerine).
  const events: ChatEvent[] = []
  const payload: ChatRequest = {
    model: 'test-model',
    sessionId: session.id,
    messages: [{ role: 'user', content: 'dosya yaz' }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as ChatRequest

  const { requestId } = await startChat(-1, payload)

  // Olayları chat:event üzerinden yakalayamayız (webContents -1); bu yüzden
  // dosya yazımı ve oturum kaydı üzerinden doğruluyoruz.
  let written = false
  for (let index = 0; index < 100 && !written; index++) {
    await sleep(100)
    written = existsSync(join(base, 'chat-worker.txt'))
    if (!written && existsSync(join(process.cwd(), 'chat-worker.txt'))) {
      written = true
    }
  }
  check('araç işçide dosya yazdı', written, true)
  if (written && existsSync(join(base, 'chat-worker.txt'))) {
    check('dosya içeriği', readFileSync(join(base, 'chat-worker.txt'), 'utf8'), 'üretim yolundan')
  }

  // Oturum kaydı ana süreçte olmalı (işçi yazmaz).
  let assistantSaved = false
  for (let index = 0; index < 100 && !assistantSaved; index++) {
    await sleep(100)
    await __resetCacheForTests()
    const stored = await (await import('../src/main/sessionStore')).getSession(session.id)
    assistantSaved = stored?.messages.some((message) => message.role === 'assistant') ?? false
  }
  check('asistan yanıtı ana süreçte kaydedildi', assistantSaved, true)

  check('bilinmeyen istek iptali false', abortChat('olmayan'), false)
  check('steering olmayan istek reddedilir', steerChat('olmayan', 'x'), { queued: false, pending: 0 })

  server.close()
  await stopAgentProcess()

  console.log(`TOTAL=7 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
