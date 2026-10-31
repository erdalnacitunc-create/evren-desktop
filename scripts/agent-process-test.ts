/// <reference types="node" />
import { app } from 'electron'
import { join } from 'path'
import { AgentProcess } from '../src/main/agent/process'

/**
 * Ajan süreci yaşam döngüsü testi (gerçek utilityProcess).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-process-test.ts
 *
 * `npm run build` önce çalışmış olmalı (out/main/agentWorker.js gerekir).
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

app.whenReady().then(async () => {
  // Test, depo kökünden çalışır; derlenmiş işçi `out/main` altındadır.
  const workerPath = join(process.cwd(), 'out', 'main', 'agentWorker.js')

  // ===== 1) başlatma =====
  const agent = new AgentProcess({ modulePath: workerPath, startTimeoutMs: 20_000 })
  await agent.start()
  const status = agent.status()
  check('süreç çalışıyor', status.running, true)
  check('pid var', typeof status.pid === 'number' && (status.pid ?? 0) > 0, true)
  check('başlangıç zamanı', typeof status.startedAt, 'number')

  // ===== 2) ping → pong =====
  const pong = await agent.ping(10_000)
  check('pong protokol sürümü', pong.protocol, 1)
  check('pong pid ana süreçten farklı', pong.pid !== process.pid, true)
  check('pong uptime sayı', typeof pong.uptimeMs, 'number')

  // ===== 3) bilinmeyen yöntem =====
  const unknown = await agent.request('bilinmeyenYontem', {})
  check('bilinmeyen yöntem hatası', unknown.kind, 'error')
  check(
    'hata kodu',
    (unknown.payload as { code: string }).code,
    'unknown-method'
  )

  // ===== 4) eşzamanlı istekler eşleşiyor =====
  const results = await Promise.all([
    agent.request('ping', {}),
    agent.request('ping', {}),
    agent.request('ping', {})
  ])
  check('üç yanıt geldi', results.length, 3)
  check('hepsi response', results.every((message) => message.kind === 'response'), true)
  check(
    'kimlikler farklı',
    new Set(results.map((message) => message.id)).size,
    3
  )

  // ===== 5) istek sayacı =====
  check('istek sayacı arttı', agent.status().requests >= 5, true)

  // ===== 6) düzgün kapanış =====
  const pidBefore = agent.status().pid
  await agent.stop()
  check('kapanış sonrası çalışmıyor', agent.status().running, false)
  check('pid temizlendi', agent.status().pid, undefined)

  // ===== 7) süreç gerçekten öldü mü? =====
  let alive = true
  try {
    process.kill(pidBefore as number, 0)
  } catch {
    alive = false
  }
  check('işletim sisteminde süreç yok', alive, false)

  // ===== 8) istek otomatik başlatır =====
  const autoStarted = await agent.request('ping', {}, 10_000)
  check('istek süreci yeniden başlattı', autoStarted.kind, 'response')
  check('otomatik başlatma durumu', agent.status().running, true)
  await agent.stop()

  await agent.stop()

  // ===== 9) yeniden başlatma =====
  await agent.start()
  const restarted = await agent.ping(10_000)
  check('yeniden başladı', agent.status().running, true)
  check('yeni pid farklı', restarted.pid !== pidBefore, true)
  await agent.stop()

  // ===== 10) hata durumunda açık hata =====
  const broken = new AgentProcess({ modulePath: join(process.cwd(), 'out', 'main', 'yok.js') })
  let brokenError = ''
  try {
    await broken.start()
  } catch (error) {
    brokenError = error instanceof Error ? error.message : String(error)
  }
  check('eksik işçi anlaşılır hata verir', brokenError.includes('bulunamadı'), true)
  check('eksik işçi durumu', broken.status().running, false)

  console.log(`TOTAL=20 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
