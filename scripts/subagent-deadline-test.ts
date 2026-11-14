/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { runWithWorkspace } from '../src/main/workspace'
import { readSubagentLogs } from '../src/main/agent/subagentLog'

/**
 * Alt ajan süre bütçesinin **akışa** uygulandığını doğrular.
 * Çalıştırma: node scripts/run-unit.cjs scripts/subagent-deadline-test.ts
 *
 * ## Canlı kusur (0.4.14)
 *
 * İki explore ajanı 482 ve 575 sn sürdü; bütçe 210 sn'ydi ama uygulanmıyordu.
 * Zaman araçlarda değildi (toplam 10-15 sn) — model tek parçada 291/423 sn
 * üretiyordu. `DEADLINE_MS` yalnızca adım başında kontrol ediliyordu.
 *
 * Bu test yavaş akan bir sağlayıcı taklit eder: bütçe dolunca üretim kesilmeli
 * ve ajan **kısmi sonuç** döndürmeli (boş veya hata değil).
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
process.env['EVREN_SUBAGENT_LOG_DIR'] = join(dataDir, 'logs')
// Bütçeyi test için kısalt (üretim varsayılanı 420 sn).
process.env['EVREN_SUBAGENT_DEADLINE_MS'] = '9000'
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      // İlk parça hemen: akış "başlamış" sayılsın (outputStarted).
      response.write(sse({ choices: [{ delta: { content: 'Rapor basliyor. ' } }] }))

      let sent = 0
      // 40 sn boyunca her 400 ms'de bir parça (bütçe çok önce dolmalı).
      const timer = setInterval(() => {
        sent += 1
        if (response.writableEnded) {
          clearInterval(timer)
          return
        }
        response.write(
          sse({ choices: [{ delta: { content: `Bolum ${sent}. Bu metin bilincli olarak uzun. ` } }] })
        )
        if (sent >= 100) {
          clearInterval(timer)
          response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
          response.end('data: [DONE]\n\n')
        }
      }, 400)
      response.on('close', () => clearInterval(timer))
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
  const base = join(dataDir, 'deadline-workspace')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })

  const { server, port } = await startServer()
  const startedAt = Date.now()

  const result = await runWithWorkspace(base, () =>
    runSubagent({
      parentRequestId: 'req-deadline',
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test',
      model: 'deadline-model',
      agentType: 'explore',
      prompt: 'Uzun bir web arastirmasi yap ve raporla.',
      workspaceRoot: base,
      mode: 'auto',
      profile: 'build',
      controller: new AbortController(),
      send: () => undefined,
      subagentTaskId: 'sub-deadline-probe'
    })
  )
  const elapsed = Date.now() - startedAt
  server.close()

  console.log(`\nsüre: ${Math.round(elapsed / 1000)} sn · ok=${result.ok} · kısmi=${result.partial ?? false} (${result.partialReason ?? '-'})`)
  console.log(`içerik: ${result.content.length} kr`)

  // ===== iddialar =====
  check('sonuç hata değil', result.ok, true)
  check('kısmi işaretli', result.partial, true)
  check('neden deadline', result.partialReason, 'deadline')
  check('bütçe gerçekten uygulandı (< 20 sn)', elapsed < 20_000, true)
  check('bütçe çok erken kesmedi (> 5 sn)', elapsed > 5_000, true)
  check('kısmi içerik korundu', result.content.length > 20, true)
  check('kesinti açıklaması var', result.content.includes('task_continue'), true)

  // ===== günlük: bütçe kesintisi kaydedildi =====
  const events = readSubagentLogs({ taskId: 'sub-deadline-probe', limit: 200 })
  const budget = events.filter((event) => event.phase === 'budget')
  const finish = events.filter((event) => event.phase === 'finish')
  check('günlükte bütçe olayı var', budget.length >= 1, true)
  check(
    'günlükte akış kesintisi',
    budget.some((event) => event.msg.includes('akış bütçesi')),
    true
  )
  check('günlükte kısmi bitiş', finish.some((event) => event.msg.includes('kısmi')), true)

  console.log(`TOTAL=12 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
