/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { listSubagentTasks } from '../src/main/agent/taskManager'
import { listMemories } from '../src/main/memory/store'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, SubagentTaskInfo, ToolResultInfo } from '../src/shared/types'

/**
 * Üç fazlı alt ajan tetiklenme sınaması (0.4.17, yalnızca deepseek).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-3phase-test.ts
 *
 * Faz 1 — mevcut proje klasörünün detaylı incelenmesi (wifi klima, 79 dosya)
 * Faz 2 — web üzerinde alt ajanlarla detaylı araştırma
 * Faz 3 — basit kodlama: iki hata, iki general ajan, dosya sahipliği zorlaması
 *
 * Her faz için ölçülenler: spawn sayısı/türü, task_wait sonuçları, kısmi
 * sonuçlar, ilerleme yönlendirmesinin okuma sırasında tetiklenip
 * tetiklenmediği (0.4.17 düzeltmesi), üretilen dosyalar.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
// Alt ajan günlüğü bu koşuya ait olmalı: ön okuma ölçümü buradan okunuyor.
process.env['EVREN_SUBAGENT_LOG_DIR'] = join(dataDir, 'logs')
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

const MODEL = 'deepseek-v4.1-flash'
const PROJE = 'C:\\Users\\erdal\\Desktop\\wifi klima'

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface PhaseResult {
  label: string
  seconds: number
  spawns: Array<{ agent: string; description: string; ok: boolean; files: string[] }>
  waits: Array<{ ok: boolean; length: number; stillRunning: boolean }>
  tasks: SubagentTaskInfo[]
  text: string
  tools: Record<string, number>
  events: number
  nudges: number
  parallelTriggers: number
  parallelCalls: number
  prefetchedTotal: number
  prefetchedAgents: number
  emptyExecutes: number
}

/**
 * Günlükten yönlendirme sayısını okur.
 *
 * Neden günlük: yönlendirme metni `messages` dizisine eklenir, olay akışına
 * (`sink`) **yayınlanmaz**. 0.4.17 testi `content` olaylarında aradığı için
 * hiçbir zaman bulamadı ve yanlışlıkla "0" diye geçti (boş ölçüm). Doğru yol
 * `logs/main.log` satırlarını zaman penceresiyle saymak.
 */
function countNudges(fromMs: number, toMs: number): number {
  try {
    const file = join(process.env.EVREN_TEST_DATA as string, 'logs', 'main.log')
    if (!existsSync(file)) return -1
    const raw = readFileSync(file, 'utf8')
    let count = 0
    for (const line of raw.split('\n')) {
      if (!line.includes('İlerlemesiz döngü')) continue
      const match = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/.exec(line)
      if (!match) continue
      const at = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
        Number(match[7])
      ).getTime()
      if (at >= fromMs - 5000 && at <= toMs + 5000) count += 1
    }
    return count
  } catch {
    return -1
  }
}

/** Zaman penceresindeki main.log satırları. */
function readLogText(fromMs: number, toMs: number): string {
  try {
    const file = join(process.env.EVREN_TEST_DATA as string, 'logs', 'main.log')
    if (!existsSync(file)) return ''
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => {
        const match = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/.exec(line)
        if (!match) return false
        const at = new Date(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
          Number(match[7])
        ).getTime()
        return at >= fromMs - 5000 && at <= toMs + 5000
      })
      .join('\n')
  } catch {
    return ''
  }
}

interface StartLog {
  taskId?: string
  agentType?: string
  files?: string[]
}

/** Alt ajan `start` olaylarındaki ön okuma bilgisi (subagent-events.jsonl). */
function subagentStartLogs(fromMs: number, toMs: number): StartLog[] {
  try {
    const file = join(process.env.EVREN_SUBAGENT_LOG_DIR as string, 'subagent-events.jsonl')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as {
            at?: number
            phase?: string
            taskId?: string
            agentType?: string
            data?: { prefetchedFiles?: string[] }
          }
        } catch {
          return null
        }
      })
      .filter(
        (event): event is NonNullable<typeof event> =>
          Boolean(event) &&
          event!.phase === 'start' &&
          typeof event!.at === 'number' &&
          event!.at! >= fromMs - 5000 &&
          event!.at! <= toMs + 5000
      )
      .map((event) => ({
        taskId: event.taskId,
        agentType: event.agentType,
        files: event.data?.prefetchedFiles ?? []
      }))
  } catch {
    return []
  }
}

async function runPhase(options: {
  label: string
  workspace: string | null
  prompt: string
  timeoutMin?: number
  expectSpawn?: boolean
}): Promise<PhaseResult> {
  console.log(`\n${'='.repeat(70)}\n${options.label}\n${'='.repeat(70)}`)
  const sink = createRecordingSink()
  const requestId = `phase-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const payload = {
    model: MODEL,
    messages: [{ role: 'user', content: options.prompt }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: options.workspace !== null
    }
  } as ChatRequest

  const startedAt = Date.now()
  /** Bu faza ait görevleri ayırmak için başlangıçtaki kimlikler. */
  const tasksBefore = new Set(listSubagentTasks().map((task) => task.id))
  const exec = () =>
    runAgent({
      requestId,
      webContentsId: 0,
      baseUrl: settings.baseUrl,
      apiKey: apiKey as string,
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: options.workspace
    })

  if (options.workspace) await runWithWorkspace(options.workspace, exec)
  else await exec()

  const limit = (options.timeoutMin ?? 12) * 60
  for (let index = 0; index < limit; index += 1) {
    const running = listSubagentTasks().filter((task) => task.status === 'running').length
    if (running === 0) break
    await sleep(1000)
  }
  await sleep(500)

  const results = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => Boolean(result))

  const spawns = results
    .filter((result) => result.name === 'spawn_agent')
    .map((result, index) => {
      const calls = sink.events.filter(
        (event) => event.type === 'tool-call' && (event as { call?: { name?: string } }).call?.name === 'spawn_agent'
      )
      const call = calls[index]
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(String((call as { call?: { arguments?: string } }).call?.arguments ?? '{}'))
      } catch {
        // yut
      }
      return {
        agent: String(args['agent'] ?? '?'),
        description: String(args['description'] ?? ''),
        ok: result.ok,
        files: Array.isArray(args['files']) ? (args['files'] as string[]).map(String) : []
      }
    })

  const waits = results
    .filter((result) => result.name === 'task_wait')
    .map((result) => ({
      ok: result.ok,
      length: String(result.content).length,
      stillRunning: String(result.content).includes('hâlâ çalışıyor')
    }))

  const tools: Record<string, number> = {}
  for (const event of sink.events) {
    if (event.type !== 'tool-call') continue
    const name = (event as { call?: { name?: string } }).call?.name ?? '?'
    tools[name] = (tools[name] ?? 0) + 1
  }

  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')

  // İlerleme yönlendirmesi: yalnızca günlükten ve zaman penceresiyle sayılır.
  const finishedAt = Date.now()
  const nudges = countNudges(startedAt, finishedAt)
  if (nudges < 0) console.log('  (uyarı: main.log okunamadı, yönlendirme sayısı bilinmiyor)')

  // 0.4.21 ölçümleri: paralel araç tetiklenmesi ve ön okuma.
  const mainLog = readLogText(startedAt, finishedAt)
  const parallelTriggers = (mainLog.match(/paralel araç: \d+ çağrı/g) ?? []).length
  const parallelCalls = [...mainLog.matchAll(/paralel araç: (\d+) çağrı/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0
  )
  const prefetchedTotal = subagentStartLogs(startedAt, finishedAt).reduce(
    (sum, entry) => sum + (entry.files?.length ?? 0),
    0
  )
  const prefetchedAgents = subagentStartLogs(startedAt, finishedAt).filter(
    (entry) => (entry.files?.length ?? 0) > 0
  ).length

  const emptyExecutes = results.filter(
    (result) =>
      result.name === 'execute' &&
      result.ok &&
      ['{}', 'undefined', '[]', 'null', ''].includes(String(result.content).trim())
  ).length

  return {
    label: options.label,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    spawns,
    waits,
    // Yalnızca bu fazda oluşan görevler (önceki fazlarınkiler gelmesin).
    tasks: listSubagentTasks().filter((task) => !tasksBefore.has(task.id)),
    text,
    tools,
    events: sink.events.length,
    nudges,
    parallelTriggers,
    parallelCalls,
    prefetchedTotal,
    prefetchedAgents,
    emptyExecutes
  }
}

let settings: Awaited<ReturnType<typeof getSettings>>
let apiKey: string | null

app.whenReady().then(async () => {
  settings = await getSettings()
  apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(3)
    return
  }

  // ===== ortam doğrulaması =====
  const memories = await listMemories().catch(() => [])
  check('bellek temiz', memories.length, 0)
  console.log(`model: ${MODEL}`)

  // ---------------------------------------------------------------- FAZ 1
  const faz1 = await runPhase({
    label: 'FAZ 1 — mevcut proje klasörünün detaylı incelenmesi',
    workspace: PROJE,
    prompt:
      'Bu projeyi detaylı incele. Katmanları, her dosyanın gerçek sorumluluğunu, ' +
      'protokol/veri akışını ve riskleri dosya referanslarıyla açıkla. ' +
      'İnceleme için alt ajanları kullan: her katmanı ayrı bir ajana ver.'
  })
  console.log(
    `\nsonuç: ${faz1.seconds} sn · araç ${Object.values(faz1.tools).reduce((a, b) => a + b, 0)} · ` +
      `spawn ${faz1.spawns.length} · yanıt ${faz1.text.length} kr`
  )
  for (const spawn of faz1.spawns) {
    console.log(`  ${spawn.agent.padEnd(8)} ${spawn.ok ? 'kabul' : 'RET  '} ${spawn.description || '(etiket yok)'}`)
  }
  check('Faz1: alt ajan tetiklendi', faz1.spawns.length >= 1, true)
  check('Faz1: açıklama verildi', faz1.spawns.every((spawn) => spawn.description.length > 0), true)
  check('Faz1: task_wait hata vermedi', faz1.waits.every((wait) => wait.ok), true)
  check('Faz1: her görev sonuç üretti', faz1.tasks.every((task) => (task.result?.length ?? 0) > 0), true)
  check('Faz1: boş execute yok', faz1.emptyExecutes, 0)
  check('Faz1: rapor yazıldı', faz1.text.length > 2000, true)

  // ---------------------------------------------------------------- FAZ 2
  const faz2 = await runPhase({
    label: 'FAZ 2 — web üzerinde alt ajanlarla detaylı araştırma',
    workspace: null,
    timeoutMin: 15,
    prompt:
      'Web üzerinde detaylı araştırma yap: ESP8266 (ESP-01) tabanlı cihazları WiFi ile ' +
      'kontrol eden açık kaynak projeler nasıl yapılandırılmış? En az üç bağımsız konuyu ' +
      '(a) benzer açık kaynak projeler, (b) MQTT/TLS güvenlik yaklaşımları, ' +
      '(c) alternatif mimariler (bulut vs yerel köprü) olarak ayrı alt ajanlara ver. ' +
      'Kaynak URL ver. Bulguları tek bir karşılaştırmalı raporda birleştir.'
  })
  console.log(
    `\nsonuç: ${faz2.seconds} sn · araç ${Object.values(faz2.tools).reduce((a, b) => a + b, 0)} · ` +
      `spawn ${faz2.spawns.length} · yanıt ${faz2.text.length} kr`
  )
  console.log(`  araç dağılımı: ${JSON.stringify(faz2.tools)}`)
  for (const spawn of faz2.spawns) {
    console.log(`  ${spawn.agent.padEnd(8)} ${spawn.ok ? 'kabul' : 'RET  '} ${spawn.description || '(etiket yok)'}`)
  }
  check('Faz2: alt ajan tetiklendi', faz2.spawns.length >= 1, true)
  check('Faz2: en az 2 ajan', faz2.spawns.filter((spawn) => spawn.ok).length >= 2, true)
  check('Faz2: task_wait hata vermedi', faz2.waits.every((wait) => wait.ok), true)
  check('Faz2: her görev sonuç üretti', faz2.tasks.every((task) => (task.result?.length ?? 0) > 0), true)
  check('Faz2: arama kullanıldı', (faz2.tools['websearch'] ?? 0) + (faz2.tools['webfetch'] ?? 0) > 0, true)
  check('Faz2: rapor yazıldı', faz2.text.length > 2000, true)

  // ---------------------------------------------------------------- FAZ 3
  const codingDir = join(dataDir, 'coding-phase')
  rmSync(codingDir, { recursive: true, force: true })
  mkdirSync(join(codingDir, 'src'), { recursive: true })
  writeFileSync(
    join(codingDir, 'README.md'),
    '# Hesap modulu\n\nIki bagimsiz modul: src/sicaklik.ts ve src/nem.ts\n',
    'utf8'
  )
  writeFileSync(
    join(codingDir, 'src', 'sicaklik.ts'),
    [
      '/** Celsius -> Fahrenheit. */',
      'export function fahrenheit(celsius: number): number {',
      '  return celsius * 2 + 32',
      '}',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(codingDir, 'src', 'nem.ts'),
    [
      '/** Bagil nem siniri (%0-100). */',
      'export function sinirla(oran: number): number {',
      '  return oran * 100',
      '}',
      ''
    ].join('\n'),
    'utf8'
  )

  const faz3 = await runPhase({
    label: 'FAZ 3 — basit kodlama (iki hata, iki general ajan)',
    workspace: codingDir,
    timeoutMin: 10,
    prompt:
      'Bu projede iki bağımsız hata var:\n' +
      '1) src/sicaklik.ts → Celsius→Fahrenheit formülü yanlış (doğrusu c*9/5+32).\n' +
      '2) src/nem.ts → sinirla() 0-100 aralığına kırpmalı, çarpmamalı.\n\n' +
      'İkisini düzelt. Modüller bağımsız olduğu için İKİ ayrı `general` alt ajana böl; ' +
      'her birine `files` ile AYRI dosya ver (aynı dosyayı iki ajana verme). ' +
      'Sonucu kısaca bildir.'
  })
  const sicaklik = readFileSync(join(codingDir, 'src', 'sicaklik.ts'), 'utf8')
  const nem = readFileSync(join(codingDir, 'src', 'nem.ts'), 'utf8')
  const sicaklikFixed = !sicaklik.includes('celsius * 2 + 32')
  const nemFixed = !nem.includes('oran * 100')

  console.log(
    `\nsonuç: ${faz3.seconds} sn · araç ${Object.values(faz3.tools).reduce((a, b) => a + b, 0)} · ` +
      `spawn ${faz3.spawns.length} · yanıt ${faz3.text.length} kr`
  )
  for (const spawn of faz3.spawns) {
    console.log(
      `  ${spawn.agent.padEnd(8)} ${spawn.ok ? 'kabul' : 'RET  '} files=${JSON.stringify(spawn.files)} ${spawn.description}`
    )
  }
  console.log(`  sicaklik düzeltildi: ${sicaklikFixed} · nem düzeltildi: ${nemFixed}`)

  const generalSpawns = faz3.spawns.filter((spawn) => spawn.agent === 'general' && spawn.ok)
  check('Faz3: general ajan kullanıldı', generalSpawns.length >= 1, true)
  check('Faz3: her general files taşıyor', generalSpawns.every((spawn) => spawn.files.length > 0), true)
  check('Faz3: task_wait hata vermedi', faz3.waits.every((wait) => wait.ok), true)
  check('Faz3: iki hata da düzeltildi', sicaklikFixed && nemFixed, true)

  // ---------------------------------------------------------------- özet
  console.log(`\n${'='.repeat(70)}\nÖZET\n${'='.repeat(70)}`)
  const rows = [faz1, faz2, faz3]
  for (const row of rows) {
    const spawnOk = row.spawns.filter((spawn) => spawn.ok).length
    const partial = row.tasks.filter((task) => task.partial).length
    console.log(
      `${row.label.slice(0, 6)} | ${String(row.seconds).padStart(5)}sn | ` +
        `araç ${String(Object.values(row.tools).reduce((a, b) => a + b, 0)).padStart(3)} | ` +
        `spawn ${spawnOk}/${row.spawns.length} | kısmi ${partial}/${row.tasks.length} | ` +
        `yanıt ${String(row.text.length).padStart(5)} kr | yönlendirme ${row.nudges} | ` +
        `paralel ${row.parallelTriggers}/${row.parallelCalls} | ön okuma ${row.prefetchedAgents} ajan/${row.prefetchedTotal} dosya`
    )
  }

  // 0.4.18 kuralı: okuma/koordinasyon yapılırken yönlendirme olmamalı.
  // Faz 1 ve 2 yoğun okuma + alt ajan beklemesi içeriyor; hiç yönlendirme
  // çıkmamalı. Faz 3 kısa olduğu için orada da beklenmez.
  const totalNudges = rows.reduce((sum, row) => sum + Math.max(0, row.nudges), 0)
  check('okuma/koordinasyon sırasında yanlış yönlendirme yok', totalNudges, 0)

  console.log(`\nTOTAL=24 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
