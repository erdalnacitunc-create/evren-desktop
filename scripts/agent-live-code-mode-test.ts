/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { listSubagentTasks } from '../src/main/agent/taskManager'
import { listMemories } from '../src/main/memory/store'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, ToolResultInfo } from '../src/shared/types'

/**
 * 0.4.16 Code Mode düzeltmesinin canlı sınaması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-code-mode-test.ts
 *
 * ## Önceki canlı koşu (0.4.15, gemma-4-31b)
 *
 * 14 `execute` çağrısının 13'ü `{}`/`undefined` döndürdü ve hepsi `ok: true`
 * raporlandı. Model 11 dosyayı okuduğunu sandı, hiçbirini okumadı; raporu
 * dosya adlarından yazdı ve uydurma uç noktalar verdi (`/status`, `/command`
 * — gerçek: `/durum`, `/k`, `/bilgi`, `/ayar`).
 *
 * ## Bu test neyi sabitler
 *
 * 1. `execute` boş sonucu artık **başarı** olarak döndürmüyor.
 * 2. Model hatayı görüp toparlıyor (sonraki adımda doğru alanı kullanıyor
 *    veya başka araca geçiyor).
 * 3. Rapor gerçek dosya/uç nokta kanıtına dayanıyor (uydurma yok).
 * 4. Bellek temiz: bu koşuda hiç hafıza kaydı yok.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

const WORKSPACE = 'C:\\Users\\erdal\\Desktop\\wifi klima'
const PROMPT =
  'masaüstünde bulunan wifi klima klasörü içinde ki projeyi incele. yapısı hakkında özet çıkar. inceleme için maksimum seviyede alt ajan kullan.'

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Boş Code Mode sonucu: içerik `{}`/`undefined`/boş. */
function isEmptyContent(value: string): boolean {
  const text = value.trim()
  return text === '' || text === '{}' || text === '[]' || text === 'undefined' || text === 'null'
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(3)
    return
  }
  const model = process.env.EVREN_TEST_MODEL || 'gemma-4-31b'

  // ===== 0) bellek temiz mi? =====
  const memories = await listMemories().catch(() => [])
  console.log(`bellek kaydı: ${memories.length}`)
  check('bellek temiz (0 kayıt)', memories.length, 0)

  const sink = createRecordingSink()
  const requestId = `live-codemode-${Date.now()}`
  const payload = {
    model,
    messages: [{ role: 'user', content: PROMPT }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as ChatRequest

  console.log(`\nmodel: ${model}`)
  console.log(`çalışma alanı: ${WORKSPACE}`)
  const startedAt = Date.now()

  await runWithWorkspace(WORKSPACE, () =>
    runAgent({
      requestId,
      webContentsId: 0,
      baseUrl: settings.baseUrl,
      apiKey,
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: WORKSPACE
    })
  )

  // Arka plan ajanları bitsin (en fazla 10 dk).
  for (let index = 0; index < 600; index += 1) {
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

  const executes = results.filter((result) => result.name === 'execute')
  const emptyButOk = executes.filter(
    (result) => result.ok && isEmptyContent(String(result.content))
  )
  const emptyNotOk = executes.filter(
    (result) => !result.ok && String(result.content).includes('boş sonuç')
  )
  const usefulExecutes = executes.filter(
    (result) => result.ok && String(result.content).trim().length > 200
  )

  const spawns = results.filter((result) => result.name === 'spawn_agent')
  const waits = results.filter((result) => result.name === 'task_wait')
  const tasks = listSubagentTasks()

  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')

  const realEndpoint = /\/durum|\/bilgi|\/k\b|haier_kare|durum_coz/i.test(text)
  const invented = /\/(status|command)\b/i.test(text)
  const falseExcuse = /dosya erişim kısıtl|erişim kısıtları yaşandı/i.test(text)

  console.log('\n' + '='.repeat(64))
  console.log('CANLI CODE MODE SINAMASI (0.4.16)')
  console.log('='.repeat(64))
  console.log(`süre: ${Math.round(durationMs / 1000)} sn`)
  console.log(
    `execute: ${executes.length} · boş-ama-ok: ${emptyButOk.length} · boş-hata: ${emptyNotOk.length} · işe yarar: ${usefulExecutes.length}`
  )
  for (const result of executes.slice(0, 10)) {
    const len = String(result.content).length
    console.log(`  ok=${result.ok} ${len}kr :: ${String(result.content).slice(0, 80).replace(/\n/g, ' ')}`)
  }
  console.log(`spawn: ${spawns.length} · task_wait: ${waits.length} (ok ${waits.filter((w) => w.ok).length}) · görev: ${tasks.length}`)

  // Tüm araç çağrılarını dök: hangi araç, ne istedi, sonuç ne döndü.
  const calls = sink.events
    .filter((event) => event.type === 'tool-call')
    .map((event) => (event as { call?: { name?: string; arguments?: string } }).call)
    .filter((call): call is { name?: string; arguments?: string } => Boolean(call))
  console.log(`\naraç çağrıları (${calls.length}):`)
  for (const call of calls) {
    console.log(`  ${String(call.name).padEnd(12)} ${String(call.arguments).slice(0, 130).replace(/\n/g, ' ')}`)
  }
  for (const task of tasks) {
    console.log(
      `  ${task.agentType} ${task.status} ${task.result?.length ?? 0}kr${task.partial ? ' [KISMİ]' : ''}`
    )
  }
  console.log(`yanıt: ${text.length} kr · gerçek uç/dosya kanıtı: ${realEndpoint} · uydurma uç: ${invented}`)
  console.log(`yanlış erişim gerekçesi: ${falseExcuse}`)
  console.log(`\n--- yanıt (ilk 1200 kr) ---\n${text.slice(0, 1200)}`)

  // ===== iddialar =====
  check('boş sonuç artık ok=true değil', emptyButOk.length, 0)
  check('execute en az bir kez çalıştı', executes.length >= 1, true)
  check(
    'hata görülünce toparlandı (işe yarar sonuç var)',
    usefulExecutes.length >= 1,
    true
  )
  check('alt ajan kullanıldı', spawns.length >= 1, true)
  check('task_wait hata vermedi', waits.every((result) => result.ok), true)
  check('her görev sonuç üretti', tasks.every((task) => (task.result?.length ?? 0) > 0), true)
  check('rapor gerçek kanıta dayanıyor', realEndpoint, true)
  check('uydurma uç nokta yok', invented, false)
  check('yanlış erişim gerekçesi yok', falseExcuse, false)
  check('yanıt yazıldı', text.length > 1200, true)

  console.log(`\nTOTAL=15 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
