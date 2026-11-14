/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { listSubagentTasks } from '../src/main/agent/taskManager'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, ToolResultInfo } from '../src/shared/types'

/**
 * Gerçek modelle web araştırması sınaması (0.4.15 onarımı).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-websearch-test.ts
 *
 * ## Ne sınanır
 *
 * 0.4.14 canlı koşusunda 15 aramanın 9'u başarısız, 2'si alakasız sonuç
 * döndürdü. Onarımdan sonra üretim yolunda:
 *
 * 1. `websearch` çağrıları **başarılı** olmalı.
 * 2. Çöp sonuç (Lidl / doğum hasarı) **kabul edilmemeli**.
 * 3. Alt ajan kullanılmalı ve sonucu rapora girmeli.
 * 4. Rapor bir kez yazılmalı (bildirim yüzünden baştan yazılmamalı).
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
  const workspace = 'C:\\Users\\erdal\\Desktop\\c3 flasher'

  const sink = createRecordingSink()
  const requestId = `live-web-${Date.now()}`
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content:
          'Bu projeye (ESP32-C3 ile ESP-01 firmware yazan bağımsız yükleyici) benzer açık ' +
          'kaynak projeleri webde araştır. 2 explore alt ajanı kullan: biri doğrudan benzer ' +
          'projeleri, diğeri protokol/doğrulama yaklaşımlarını araştırsın. ' +
          'Bulguları karşılaştırmalı, kaynak URL’li bir rapor olarak yaz. ' +
          'Raporu tek parça halinde, bir kez yaz.'
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
  await runWithWorkspace(workspace, () =>
    runAgent({
      requestId,
      webContentsId: 0,
      baseUrl: settings.baseUrl,
      apiKey,
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: workspace
    })
  )

  for (let index = 0; index < 420; index += 1) {
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

  const searches = results.filter((result) => result.name === 'websearch')
  const searchOk = searches.filter((result) => result.ok)
  const searchFail = searches.filter((result) => !result.ok)
  const spawns = results.filter((result) => result.name === 'spawn_agent')
  const waits = results.filter((result) => result.name === 'task_wait')

  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  const lower = text.toLowerCase()
  const garbage = /lidl|birth injury|cleveland|store finder/.test(lower)
  const tasks = listSubagentTasks()
  const reportHeadings = (text.match(/^## /gm) ?? []).length

  console.log('\n' + '='.repeat(64))
  console.log('CANLI WEB ARAŞTIRMASI SINAMASI')
  console.log('='.repeat(64))
  console.log(`süre: ${Math.round(durationMs / 1000)} sn`)
  console.log(`websearch: ${searches.length} · başarılı ${searchOk.length} · başarısız ${searchFail.length}`)
  for (const result of searches.slice(0, 6)) {
    console.log(`  ${result.ok ? 'OK ' : 'RET'} ${String(result.content).split('\n')[0].slice(0, 90)}`)
  }
  console.log(`spawn: ${spawns.length} · task_wait: ${waits.length} · görev: ${tasks.length}`)
  for (const task of tasks) {
    console.log(
      `  ${task.agentType.padEnd(8)} ${task.status.padEnd(6)} sonuç=${task.result?.length ?? 0}kr${task.partial ? ' [KISMİ]' : ''}`
    )
  }
  console.log(`rapor: ${text.length} kr · ${reportHeadings} bölüm başlığı · çöp=${garbage}`)
  if (searchFail.length > 0) {
    console.log('başarısız notlar:', searchFail.map((r) => String(r.content).slice(0, 90)).join(' | '))
  }

  // ===== iddialar =====
  check('websearch kullanıldı', searches.length >= 1, true)
  check('aramaların çoğu başarılı', searchOk.length >= Math.ceil(searches.length / 2), true)
  check('çöp sonuç yok', garbage, false)
  check('alt ajan kullanıldı', spawns.length >= 1, true)
  check('task_wait hata vermedi', waits.every((result) => result.ok === true), true)
  check('görevler sonuç üretti', tasks.every((task) => (task.result?.length ?? 0) > 0), true)
  check('rapor yazıldı', text.length > 1500, true)

  console.log(`\nTOTAL=7 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
