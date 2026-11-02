/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { startChat } from '../src/main/chat'
import {
  __flushWritesForTests,
  __resetCacheForTests,
  appendMessage,
  createSession,
  getSession,
  patchSession
} from '../src/main/sessionStore'
import { saveApiKey } from '../src/main/credentials'
import { getSettings, setBaseUrl } from '../src/main/settings'
import type { ChatRequest } from '../src/shared/types'

/**
 * Kalıcı retry durumunun canlı testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/persist-retry-test.ts
 *
 * ## Neden
 *
 * Canlı koşuda 3 retry oldu (`Model şu anda dolu` / HTTP 429) ama
 * `sessions.json` içinde **hiç** `retry` alanı oluşmadı. Kök neden:
 * `patchAssistantRetry` mesajı `requestId` ile arıyordu, oysa asistan kaydı
 * akış **bitince** yazılıyor — retry anında mesaj yoktu, yazma sessizce
 * boşa gidiyordu. Özellik 0.4.1'de eklenmişti ama hiç çalışmamıştı.
 *
 * Bu test o boşluğu kapatır:
 *  1. Sağlayıcı ilk istekte 429 döner (Retry-After yok).
 *  2. Bekleme penceresinde `sessions.json` okunur → `retry` alanı görünmeli
 *     (deneme numarası, zaman damgası, hata tipi).
 *  3. Akış tamamlanınca `retry` temizlenmiş olmalı.
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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let requests = 0
const seenAt: number[] = []

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      requests += 1
      seenAt.push(Date.now())

      if (requests === 1) {
        // 429, Retry-After yok → politika gecikmesi (≈2 sn) uygulanır.
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Model şu anda dolu' } }))
        return
      }

      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(sse({ choices: [{ delta: { content: 'Tarama tamam.' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
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

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'persist-retry')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })

  await __resetCacheForTests()
  await getSettings()
  await saveApiKey('test-key-persist-retry')

  const { server, port } = await startServer()
  await setBaseUrl(`http://127.0.0.1:${port}`)

  const session = await createSession('test-model')
  await patchSession(session.id, { workspacePath: base } as never)
  await appendMessage(session.id, {
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

  // ===== 1) bekleme penceresinde retry alanı görünmeli =====
  let observedRetry: { attempt?: number; at?: number; type?: string; message?: string } | null = null
  for (let index = 0; index < 40 && !observedRetry; index++) {
    await sleep(50)
    const stored = await getSession(session.id)
    const assistant = stored?.messages.find((message) => message.requestId)
    if (assistant?.retry) {
      observedRetry = {
        attempt: assistant.retry.attempt,
        at: assistant.retry.at,
        type: assistant.retry.error.type,
        message: assistant.retry.error.message
      }
    }
  }

  check('retry kalıcı kayda yazıldı', observedRetry !== null, true)
  check('deneme numarası 1', observedRetry?.attempt, 1)
  // Metin sınıflandırılmış olabilir ("Sunucu istek sınırı"); sağlayıcının ham
  // mesajı her zaman korunmaz. Önemli olan boş olmaması ve türün taşınması.
  check('hata mesajı dolu', typeof observedRetry?.message === 'string' && (observedRetry?.message ?? '').length > 0, true)
  check('hata türü taşındı', observedRetry?.type, 'Retryable')
  check(
    'zaman damgası ileriye bakar',
    typeof observedRetry?.at === 'number' && (observedRetry?.at ?? 0) > Date.now() - 10_000,
    true
  )

  // ===== 2) akış tamamlanana kadar bekle =====
  let finished = false
  for (let index = 0; index < 200 && !finished; index++) {
    await sleep(100)
    await __resetCacheForTests()
    const stored = await getSession(session.id)
    const assistant = stored?.messages.find((message) => message.role === 'assistant')
    finished = Boolean(assistant?.finishReason === 'stop' && assistant?.content)
  }
  server.close()
  await __flushWritesForTests()

  check('akış tamamlandı', finished, true)
  check('sunucuya 2 istek gitti', requests, 2)
  check('denemeler arası bekleme var', (seenAt[1] ?? 0) - (seenAt[0] ?? 0) >= 1000, true)

  // ===== 3) başarıdan sonra retry temizlenmeli =====
  const final = await getSession(session.id)
  const finalAssistant = final?.messages.find((message) => message.role === 'assistant')
  check('retry temizlendi', finalAssistant?.retry, undefined)
  check('içerik yazıldı', finalAssistant?.content, 'Tarama tamam.')
  check('tek asistan mesajı (yer tutucu yeniden kullanıldı)', final?.messages.filter((m) => m.role === 'assistant').length, 1)

  console.log(`TOTAL=11 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
