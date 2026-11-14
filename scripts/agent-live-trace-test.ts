/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { listSubagentTasks } from '../src/main/agent/taskManager'
import { readSubagentLogs, summarizeSubagentLogs } from '../src/main/agent/subagentLog'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, SubagentTaskInfo, ToolResultInfo } from '../src/shared/types'

/**
 * Gerçek modelle alt ajan izleme sınaması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-trace-test.ts
 *
 * ## Ne sınanır
 *
 * 0.4.14'ün iki kusur düzeltmesi üretim yolunda:
 *
 * 1. `task_wait` zaman aşımı **`ok:false` dönmemeli** (sonuç kaybının nedeni).
 * 2. Biten alt ajanın sonucu kaybolmamalı; her görev sonuç üretmeli.
 * 3. Yapılandırılmış günlük gerçek araç süreleriyle yazılmalı.
 * 4. Ana ajan, alt ajanı beklerken yanıtsız kalmamalı.
 *
 * Üretim yolu (`runAgent`) kullanılır; sahte sağlayıcı yoktur.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(0)
    return
  }
  const model = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'

  const sink = createRecordingSink()
  const requestId = `live-trace-${Date.now()}`
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content:
          'C:\\Users\\erdal\\Desktop\\medicast klasörünü incele. İKİ bağımsız alt görev var:\n' +
          '1) android-caster/app/src/main/java/com/medicast/app/ altındaki Kotlin dosyalarının sorumlulukları\n' +
          '2) tizen-tv-app/js/main.js dosyasının mimarisi ve WebSocket protokolü\n\n' +
          'Bunları İKİ ayrı `explore` alt ajanına ver (her birine ayrı `description` ve net kapsam). ' +
          'Klasör çalışma alanı dışında olduğu için alt ajanlara PowerShell ile mutlak yol vererek ' +
          'okumalarını söyle. Sonuçları toplayıp kısa bir özet yaz.'
      }
    ],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as ChatRequest

  const startedAt = Date.now()
  await runWithWorkspace('C:\\Users\\erdal\\Desktop\\medicast', () =>
    runAgent({
      requestId,
      webContentsId: 0,
      baseUrl: settings.baseUrl,
      apiKey,
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: 'C:\\Users\\erdal\\Desktop\\medicast'
    })
  )

  // Arka plan görevleri bitsin (en fazla 8 dk).
  for (let index = 0; index < 480; index += 1) {
    const running = listSubagentTasks().filter((task) => task.status === 'running').length
    if (running === 0) break
    await sleep(1000)
  }
  await sleep(500)
  const durationMs = Date.now() - startedAt

  const results = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => Boolean(result))

  const spawns = results.filter((result) => result.name === 'spawn_agent')
  const waits = results.filter((result) => result.name === 'task_wait')
  const tasks = listSubagentTasks()
  const summary = summarizeSubagentLogs({ requestId })
  const toolLogs = readSubagentLogs({ requestId, limit: 500 }).filter(
    (event) => event.phase === 'tool' && typeof event.data?.['durationMs'] === 'number'
  )

  console.log('\n' + '='.repeat(64))
  console.log('CANLI ALT AJAN İZLEME SINAMASI')
  console.log('='.repeat(64))
  console.log(`süre: ${Math.round(durationMs / 1000)} sn`)
  console.log(`spawn: ${spawns.length} · task_wait: ${waits.length} · görev: ${tasks.length}`)
  for (const task of tasks) {
    console.log(
      `  ${task.agentType.padEnd(8)} ${task.status.padEnd(9)} ${String(task.description ?? '-').slice(0, 32).padEnd(34)} ` +
        `sonuç=${task.result?.length ?? 0}kr${task.partial ? ' [KISMİ]' : ''}`
    )
  }
  console.log(`günlük: ${summary.total} olay · hata ${summary.errors} · uyarı ${summary.warnings}`)
  if (summary.errorMessages.length > 0) {
    console.log('hatalar:', summary.errorMessages.slice(0, 3).join(' | '))
  }

  // ===== iddialar =====
  check('en az bir spawn', spawns.length >= 1, true)
  check('görevler oluştu', tasks.length >= 1, true)
  check(
    'task_wait hata gibi dönmedi',
    waits.every((result) => result.ok === true),
    true
  )
  check(
    'her görev sonuç üretti',
    tasks.every((task: SubagentTaskInfo) => (task.result?.length ?? 0) > 0),
    true
  )
  check('günlük yazıldı', summary.total > 0, true)
  check('araç süreleri kaydedildi', toolLogs.length > 0, true)
  check('günlükte hata yok', summary.errors, 0)

  console.log(`\nTOTAL=7 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
