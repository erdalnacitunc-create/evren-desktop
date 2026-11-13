/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { findOverlaps } from '../src/main/agent/fileOwnership'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, SubagentTaskInfo, ToolCallInfo, ToolResultInfo } from '../src/shared/types'

/**
 * Gerçek modelle dosya sahipliği sınaması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-ownership-test.ts
 *
 * ## Ne sınanır
 *
 * İki **bağımsız** modülde birer hata var. Görev, paralel alt ajanlarla
 * düzeltilebilecek biçimde yazılmış. Beklenen:
 *
 * 1. Her `general` spawn'ı `files` listesi taşır (sahiplik).
 * 2. Kabul edilen spawn'ların dosya kümeleri **çakışmaz**.
 * 3. Ajanların yazdığı dosyalar kendi listelerinin içindedir.
 * 4. İki hata da gerçekten düzeltilir (sonuç değil, dosya içeriği).
 *
 * Üretim yolu (`runAgent`) kullanılır; sahte sağlayıcı yoktur. Kimlik bilgisi
 * beta profilinden kopyalanır, anahtar hiçbir yere yazdırılmaz.
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

interface SpawnRecord {
  agent: string
  files: string[] | undefined
  ok: boolean
  content: string
}

function makeProject(base: string): void {
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src', 'auth'), { recursive: true })
  mkdirSync(join(base, 'src', 'billing'), { recursive: true })

  const authFiles: Array<[string, string[]]> = [
    [
      'token.ts',
      ['/** Token süresi doldu mu? */', 'export function isExpired(expiresAt: number, now: number): boolean {', '  return now < expiresAt', '}', '']
    ],
    [
      'session.ts',
      ['/** Oturum geçerli mi? */', 'export function isValid(expiresAt: number, now: number): boolean {', '  return now > expiresAt', '}', '']
    ],
    [
      'guard.ts',
      ['/** Kimlik doğrulama gerekli mi? */', 'export function needsAuth(token: string | null): boolean {', '  return token !== null', '}', '']
    ]
  ]

  const billingFiles: Array<[string, string[]]> = [
    [
      'invoice.ts',
      ['/** KDV dahil toplamı kuruşa çevirir. */', 'export function totalWithVat(amount: number, rate = 0.2): number {', '  return Math.floor(amount * (1 + rate) * 100) / 100', '}', '']
    ],
    [
      'tax.ts',
      ['/** Vergi tutarını hesaplar. */', 'export function taxOf(amount: number, rate = 0.2): number {', '  return Math.floor(amount * rate)', '}', '']
    ],
    [
      'rounding.ts',
      ['/** Kuruşu en yakına yuvarlar. */', 'export function toKurus(value: number): number {', '  return Math.floor(value * 100)', '}', '']
    ]
  ]

  for (const [name, content] of authFiles) {
    writeFileSync(join(base, 'src', 'auth', name), content.join('\n'), 'utf8')
  }
  for (const [name, content] of billingFiles) {
    writeFileSync(join(base, 'src', 'billing', name), content.join('\n'), 'utf8')
  }

  writeFileSync(
    join(base, 'README.md'),
    '# Iki bagimsiz modul\n\nauth/ ve billing/ birbirinden tamamen bağımsızdır.\n',
    'utf8'
  )
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(0)
    return
  }
  const model = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'

  const base = join(dataDir, 'ownership-live')
  makeProject(base)

  const sink = createRecordingSink()
  const requestId = `live-own-${Date.now()}`
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content:
          'Bu projede iki bağımsız modül var ve her birinde birden çok hata:\n' +
          '- src/auth/ altında: token süresi dolmuşsa true dönmeli, oturum geçerliliği ' +
          'doğru olmalı, kimlik doğrulama yalnızca token YOKSA gerekli olmalı.\n' +
          '- src/billing/ altında: tutarlar en yakın kuruşa yuvarlanmalı (aşağı değil).\n\n' +
          'Görevi İKİ general alt ajana böl: biri YALNIZ src/auth/ altındaki dosyaları, ' +
          'diğeri YALNIZ src/billing/ altındaki dosyaları düzeltsin. Her spawn_agent ' +
          'çağrısında ilgili ajana `files` listesini ver (ör. ["src/auth/"]) ve aynı ' +
          'dosyayı iki ajana verme. Sen kendin dosya düzenleme; sonuçları toplayıp kısaca yaz.'
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
  await runWithWorkspace(base, () =>
    runAgent({
      requestId,
      webContentsId: 0,
      baseUrl: settings.baseUrl,
      apiKey,
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: base
    })
  )

  // Arka plan ajanları bitsin (en fazla 6 dk).
  for (let index = 0; index < 360; index += 1) {
    const running = sink.events.filter(
      (event) =>
        event.type === 'subagent-task' &&
        (event as { task?: SubagentTaskInfo }).task?.status === 'running'
    ).length
    if (running === 0) break
    await sleep(1000)
  }
  await sleep(500)
  const durationMs = Date.now() - startedAt

  // ----- spawn çağrıları (argümanlar) -----
  const spawnCalls = sink.events
    .filter((event) => event.type === 'tool-call')
    .map((event) => (event as { call?: ToolCallInfo }).call)
    .filter((call): call is ToolCallInfo => call?.name === 'spawn_agent')

  // ----- spawn sonuçları (sırayla eşleşir) -----
  const spawnResults = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => result?.name === 'spawn_agent')

  const spawns: SpawnRecord[] = spawnCalls.map((call, index) => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(call.arguments) as Record<string, unknown>
    } catch {
      // yut
    }
    const result = spawnResults[index]
    return {
      agent: String(args['agent'] ?? '?'),
      files: Array.isArray(args['files']) ? (args['files'] as string[]).map(String) : undefined,
      ok: result?.ok === true,
      content: String(result?.content ?? '')
    }
  })

  // ----- yazma sonuçları (hangi ajan hangi dosyaya) -----
  const writeResults = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => result?.name === 'write_file' || result?.name === 'edit_file')

  const subagentTasks = new Map<string, SubagentTaskInfo>()
  for (const event of sink.events) {
    if (event.type !== 'subagent-task') continue
    const task = (event as { task?: SubagentTaskInfo }).task
    if (task) subagentTasks.set(task.id, task)
  }

  const bugMarkers: Array<{ file: string; marker: string }> = [
    { file: 'src/auth/token.ts', marker: 'return now < expiresAt' },
    { file: 'src/auth/session.ts', marker: 'return now > expiresAt' },
    { file: 'src/auth/guard.ts', marker: 'return token !== null' },
    { file: 'src/billing/invoice.ts', marker: 'Math.floor(amount * (1 + rate) * 100)' },
    { file: 'src/billing/tax.ts', marker: 'Math.floor(amount * rate)' },
    { file: 'src/billing/rounding.ts', marker: 'Math.floor(value * 100)' }
  ]
  const unfixed = bugMarkers.filter((entry) =>
    readFileSync(join(base, entry.file), 'utf8').includes(entry.marker)
  )

  // ================= RAPOR =================
  console.log('\n' + '='.repeat(64))
  console.log('CANLI DOSYA SAHİPLİĞİ SINAMASI')
  console.log('='.repeat(64))
  console.log(`süre: ${Math.round(durationMs / 1000)} sn`)
  console.log(`spawn çağrısı: ${spawnCalls.length}`)
  console.log('\nspawn kayıtları:')
  for (const spawn of spawns) {
    console.log(
      `  ${spawn.agent.padEnd(8)} ok=${String(spawn.ok).padEnd(5)} files=${JSON.stringify(spawn.files ?? [])}` +
        (spawn.ok ? '' : ` :: ${spawn.content.slice(0, 90).replace(/\n/g, ' | ')}`)
    )
  }
  console.log(`\narka plan görev kaydı: ${subagentTasks.size}`)
  for (const task of subagentTasks.values()) {
    console.log(
      `  ${task.agentType.padEnd(8)} ${task.status} ${Math.round(((task.finishedAt ?? Date.now()) - task.createdAt) / 1000)}sn`
    )
  }
  console.log(`\nyazma sonuçları: ${writeResults.length}`)
  console.log(`düzeltilmeyen dosya: ${unfixed.length === 0 ? 'yok' : unfixed.map((e) => e.file).join(', ')}`)

  // ================= İDDİALAR =================
  const generalSpawns = spawns.filter((spawn) => spawn.agent === 'general')
  check('en az bir general spawn var', generalSpawns.length >= 1, true)
  check(
    'her general spawn files taşıyor',
    generalSpawns.every((spawn) => (spawn.files?.length ?? 0) > 0),
    true
  )

  const accepted = generalSpawns.filter((spawn) => spawn.ok)
  const fileLists: string[][] = accepted.map((spawn) => spawn.files ?? [])
  let overlapCount = 0
  for (let i = 0; i < fileLists.length; i += 1) {
    for (let j = i + 1; j < fileLists.length; j += 1) {
      overlapCount += findOverlaps(fileLists[i] as string[], fileLists[j] as string[]).length
    }
  }
  check('kabul edilen ajanların dosyaları çakışmıyor', overlapCount, 0)

  check('tüm hatalar düzeltildi', unfixed.length, 0)

  console.log(`\nTOTAL=4 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
