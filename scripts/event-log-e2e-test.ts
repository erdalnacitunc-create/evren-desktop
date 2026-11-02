/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { startChat } from '../src/main/chat'
import { createSession, getSession, __flushWritesForTests, __resetCacheForTests } from '../src/main/sessionStore'
import { saveApiKey } from '../src/main/credentials'
import { getSettings, setBaseUrl } from '../src/main/settings'
import { projectStoredSession, readEvents } from '../src/main/sessionEvents'
import type { ChatRequest } from '../src/shared/types'

/**
 * Uçtan uca: gerçek üretim yolu (startChat) → olay günlüğü → projeksiyon.
 * Çalıştırma: node scripts/run-unit.cjs scripts/event-log-e2e-test.ts
 *
 * İddia: oturum yalnızca olay günlüğünden yeniden kurulabildiğinde,
 * depodaki mesajlarla aynı içeriği verir (OpenCode `session.sync`).
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

function startServer(script: (round: number) => string[]) {
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
                  id: 'call-e1',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"log.txt","content":"içerik"}'
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'eventlog')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })

  await __resetCacheForTests()
  await getSettings()
  await saveApiKey('test-key-eventlog')

  const { server, port } = await startServer(script)
  await setBaseUrl(`http://127.0.0.1:${port}`)

  const session = await createSession('test-model')
  await (await import('../src/main/sessionStore')).patchSession(session.id, {
    workspacePath: base
  } as never)
  // Renderer'ın yaptığı gibi kullanıcı mesajını yaz (olay günlüğüne de düşer).
  await (await import('../src/main/sessionStore')).appendMessage(session.id, {
    id: 'u1',
    role: 'user',
    content: 'dosya yaz',
    createdAt: Date.now()
  })
  await __flushWritesForTests()

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

  await startChat(-1, payload)

  // Akış bitene kadar bekle.
  let assistantSaved = false
  for (let index = 0; index < 80 && !assistantSaved; index++) {
    await sleep(100)
    await __resetCacheForTests()
    const stored = await getSession(session.id)
    assistantSaved = stored?.messages.some((m) => m.role === 'assistant') ?? false
  }
  server.close()
  await __flushWritesForTests()
  await sleep(400)

  check('asistan mesajı kaydedildi', assistantSaved, true)
  check('dosya yazıldı', existsSync(join(base, 'log.txt')), true)

  // ===== günlük =====
  const { bySession } = await readEvents()
  const events = bySession.get(session.id) ?? []
  const types = new Set(events.map((event) => event.type))

  check('günlükte olay var', events.length > 3, true)
  check('user.message yazıldı', types.has('user.message'), true)
  check('assistant.started yazıldı', types.has('assistant.started'), true)
  check('text.delta yazıldı', types.has('text.delta'), true)
  check('tool.called yazıldı', types.has('tool.called'), true)
  check('tool.result yazıldı', types.has('tool.result'), true)
  check('assistant.completed yazıldı', types.has('assistant.completed'), true)
  check(
    'sıra numaraları artan',
    events.every((e, i) => i === 0 || e.seq > events[i - 1].seq),
    true
  )

  // ===== projeksiyon =====
  const projected = await projectStoredSession(session.id)
  const stored = await getSession(session.id)
  const storedAssistant = stored?.messages.find((m) => m.role === 'assistant')

  check('projeksiyonda iki mesaj', projected.messages.length, 2)
  check('kullanıcı içeriği', projected.messages[0]?.content, 'dosya yaz')
  check('asistan metni depoyla aynı', projected.messages[1]?.content, storedAssistant?.content ?? '')
  check('asistan metni beklenen', projected.messages[1]?.content, 'Dosyayı yazıyorum. Tamamlandı.')
  check('araç çağrısı günlükte', projected.messages[1]?.toolCalls.length, 1)
  check('araç adı', projected.messages[1]?.toolCalls[0]?.name, 'write_file')
  check('araç sonucu başarılı', projected.messages[1]?.toolResults[0]?.ok, true)
  check('bitiş nedeni', projected.messages[1]?.finishReason, 'stop')
  check('bozuk olay yok', projected.skipped, 0)

  console.log(`TOTAL=21 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
