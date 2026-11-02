/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { startChat } from '../src/main/chat'
import { createSession, getSession, __flushWritesForTests, __resetCacheForTests } from '../src/main/sessionStore'
import { saveApiKey } from '../src/main/credentials'
import { getSettings, setBaseUrl } from '../src/main/settings'
import { PROGRESS_NUDGE } from '../src/main/agent/progressGuard'
import type { ChatRequest } from '../src/shared/types'

/**
 * İlerlemesiz döngü yönlendirmesinin uçtan uca testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/progress-nudge-e2e-test.ts
 *
 * Sahte sağlayıcı 6 tur boyunca metinsiz araç çağrısı döndürür. Dördüncü
 * adımdan sonra `progressGuard` devreye girip modele yönlendirme göndermeli;
 * giden istek gövdesinde bu metin görünmeli.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

/** Her istek gövdesini kaydeder; kaçıncı tur olduğunu sayar. */
const bodies: string[] = []
const SILENT_ROUNDS = 6

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      bodies.push(raw)
      const round = bodies.length
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (round <= SILENT_ROUNDS) {
        // Metin YOK, yalnızca araç çağrısı.
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-${round}`,
                      function: { name: 'list_files', arguments: '{}' }
                    }
                  ]
                }
              }
            ]
          })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
      } else {
        response.write(sse({ choices: [{ delta: { content: 'Rapor hazır.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      }
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'nudge')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'a.txt'), 'a', 'utf8')

  await __resetCacheForTests()
  await getSettings()
  await saveApiKey('test-key-nudge')

  const { server, port } = await startServer()
  await setBaseUrl(`http://127.0.0.1:${port}`)

  const session = await createSession('test-model')
  const store = await import('../src/main/sessionStore')
  await store.patchSession(session.id, { workspacePath: base } as never)
  await store.appendMessage(session.id, {
    id: 'u1',
    role: 'user',
    content: 'usb tara',
    createdAt: Date.now()
  })
  await __flushWritesForTests()

  const payload: ChatRequest = {
    model: 'test-model',
    sessionId: session.id,
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

  await startChat(-1, payload)

  let assistantSaved = false
  for (let index = 0; index < 100 && !assistantSaved; index++) {
    await sleep(100)
    await __resetCacheForTests()
    const stored = await getSession(session.id)
    assistantSaved = stored?.messages.some((m) => m.role === 'assistant') ?? false
  }
  server.close()
  await __flushWritesForTests()

  // ===== 1) yönlendirme gerçekten gönderildi =====
  const withNudge = bodies.filter((body) => body.includes(PROGRESS_NUDGE.slice(0, 60)))
  check('en az bir istekte yönlendirme var', withNudge.length >= 1, true)
  check('ilk yönlendirme 5. istekte', withNudge.length > 0 ? bodies.indexOf(withNudge[0]) + 1 : -1, 5)

  // ===== 2) yönlendirme metni tam ve doğru =====
  if (withNudge.length > 0) {
    const parsed = JSON.parse(withNudge[0] ?? '{}') as {
      messages?: Array<{ role?: string; content?: unknown }>
    }
    const nudgeMessage = (parsed.messages ?? []).find(
      (message) => typeof message.content === 'string' && message.content.includes('DURUM:')
    )
    check('tam metin taşınıyor', nudgeMessage?.content, PROGRESS_NUDGE)
    check('rol user', nudgeMessage?.role, 'user')
  }

  // ===== 3) akış yönlendirmeden sonra tamamlandı =====
  check('asistan yanıtı kaydedildi', assistantSaved, true)
  const stored = await getSession(session.id)
  const assistant = stored?.messages.find((m) => m.role === 'assistant')
  check('son metin geldi', assistant?.content, 'Rapor hazır.')

  // ===== 4) araç çağrıları yürütüldü (engellenmedi) =====
  check('6 tur araç çalıştı', bodies.length >= SILENT_ROUNDS + 1, true)

  console.log(`TOTAL=7 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
