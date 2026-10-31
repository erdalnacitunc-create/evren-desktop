/// <reference types="node" />
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { AgentProcess } from '../src/main/agent/process'
import {
  __flushWritesForTests,
  __resetCacheForTests,
  createSession,
  deleteSession,
  getSession
} from '../src/main/sessionStore'

/**
 * Uzak oturum deposu testi (gerçek utilityProcess).
 * Çalıştırma: node scripts/run-unit.cjs scripts/remote-session-test.ts
 *
 * İşçi `sessions.json`'a dokunmaz; oturum istekleri ana sürece gidip yerel
 * depoya düşer. "Tek yazar" ilkesi bu testin ana iddiasıdır.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

app.whenReady().then(async () => {
  const workerPath = join(process.cwd(), 'out', 'main', 'agentWorker.js')

  // Ana süreçte bir oturum hazırla (tek yazar).
  await __resetCacheForTests()
  const session = await createSession('model-remote')
  await __flushWritesForTests()
  const sessionsFile = join(process.env.EVREN_TEST_DATA as string, 'sessions.json')

  check('ana süreç dosyayı yazdı', existsSync(sessionsFile), true)
  const beforeText = readFileSync(sessionsFile, 'utf8')

  const agent = new AgentProcess({ modulePath: workerPath, startTimeoutMs: 20_000 })
  await agent.start()

  // ===== 1) işçi oturum sayısını ana süreçten alıyor =====
  const probe = await agent.sessionProbe()
  check('işçi uzak depoyu kullanıyor', probe.ok, true)
  check('işçi oturum sayısını gördü', probe.sessions >= 1, true)

  // ===== 2) işçi dosyayı değiştirmedi =====
  const afterText = readFileSync(sessionsFile, 'utf8')
  check('işçi dosyaya yazmadı', afterText === beforeText, true)

  // ===== 3) ana süreçte değişiklik işçiden görünür =====
  const extra = await createSession('model-extra')
  await __flushWritesForTests()
  const second = await agent.sessionProbe()
  check('yeni oturum işçiden görünür', second.sessions, probe.sessions + 1)

  // ===== 4) işçiye bilinmeyen yöntem =====
  const unknown = await agent.request('bilinmeyen', {})
  check('bilinmeyen yöntem reddedildi', unknown.kind, 'error')
  check(
    'hata kodu',
    (unknown.payload as { code: string }).code,
    'unknown-method'
  )

  // ===== 5) eşzamanlı oturum istekleri =====
  // `session.*` yöntemleri ana süreçte ele alınır; işçiye giden uç nokta
  // `session.probe` üzerinden aynı havuzu kullanır.
  const results = await Promise.all([
    agent.sessionProbe(),
    agent.sessionProbe(),
    agent.sessionProbe()
  ])
  check('üç yanıt', results.length, 3)
  check('hepsi başarılı', results.every((result) => result.ok), true)
  check('tutarlı oturum sayısı', new Set(results.map((r) => r.sessions)).size, 1)

  // ===== 6) kapanışta bekleyen istek reddedilir =====
  await agent.stop()
  check('kapanış sonrası çalışmıyor', agent.status().running, false)
  check('bekleyen istek yok', agent.status().pending, 0)

  // ===== 7) veri hâlâ yerinde =====
  await __resetCacheForTests()
  check('oturum diskte duruyor', (await getSession(session.id))?.modelId, 'model-remote')
  await deleteSession(extra.id)
  await __flushWritesForTests()

  console.log(`TOTAL=13 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
