/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest } from '../src/shared/types'

/**
 * Gerçek modelle alt ajan tetikleme sınaması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-spawn-test.ts
 *
 * Yapay bir "çok dosyalı keşif" görevi üretir: 24 dosyalı küçük bir C++ benzeri
 * proje. Görev **içerik** doğrulaması ister (gömülü sır + protokol sabitleri),
 * yani listeleme yetmez. Beklenen: model `explore` alt ajanları başlatır.
 *
 * Kimlik bilgisi: gerçek beta profilinden `credentials.bin` ve `settings.json`
 * geçici klasöre **kopyalanır** (DPAPI aynı kullanıcıya bağlı olduğu için
 * çözme çalışır). Anahtar hiçbir yere yazdırılmaz.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
// `Local State` şart: Chromium, safeStorage anahtarını orada DPAPI ile sarılı
// tutar. Yalnızca credentials.bin kopyalamak çözmeyi başarısız kılar
// (canlı testte yaşandı: "Error while decrypting the ciphertext").
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

function makeProject(base: string): void {
  rmSync(base, { recursive: true, force: true })

  const areas: Array<{ dir: string; ext: string; count: number; note: string }> = [
    { dir: 'firmware', ext: 'h', count: 15, note: 'ESP32 gömülü katman' },
    { dir: 'bulut', ext: 'ts', count: 15, note: 'Supabase edge fonksiyonları' },
    { dir: 'mobil/lib', ext: 'dart', count: 15, note: 'Flutter mobil uygulama' },
    { dir: 'masaustu/src', ext: 'ts', count: 15, note: 'Electron masaüstü panel' },
    { dir: 'araclar', ext: 'py', count: 15, note: 'Üretim/servis araçları' }
  ]

  for (const area of areas) {
    mkdirSync(join(base, area.dir), { recursive: true })
    for (let index = 0; index < area.count; index += 1) {
      writeFileSync(
        join(base, area.dir, `modul${index}.${area.ext}`),
        [
          `// ${area.note} — modul ${index}`,
          `const PORT_${index} = ${8000 + index};`,
          `const HOST_${index} = "svc-${index}.internal";`,
          `export function islem${index}(girdi: string): string { return girdi + "${index}" }`,
          ''
        ].join('\n'),
        'utf8'
      )
    }
  }

  // Gömülü sırlar — üç ayrı katmanda.
  writeFileSync(
    join(base, 'firmware', 'ayarlar.h'),
    [
      'static const char* WIFI_SIFRE = "CokGizli123!";',
      'static const char* MQTT_PAROLA = "sifre-9876";',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(base, 'bulut', 'env.ts'),
    ['export const SUPABASE_SERVICE_KEY = "tok_5f3a91b2c4d6e8";', ''].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(base, 'araclar', 'deploy.py'),
    ['API_TOKEN = "py_token_9911aa"', ''].join('\n'),
    'utf8'
  )

  writeFileSync(
    join(base, 'README.md'),
    '# Çok katmanlı proje\n\nfirmware + bulut + mobil + masaüstü + araçlar.\n',
    'utf8'
  )
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'live-spawn')
  makeProject(base)
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    console.log('  userData:', app.getPath('userData'))
    console.log('  credentials var mı:', existsSync(join(app.getPath('userData'), 'credentials.bin')))
    console.log('  safeStorage:', require('electron').safeStorage.isEncryptionAvailable())
    app.exit(0)
    return
  }

  const sink = createRecordingSink()
  const payload = {
    model: process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash',
    messages: [
      {
        role: 'user',
        content:
          'Projedeki TÜM katmanların (firmware, bulut, mobil, masaüstü, araçlar) içeriğini incele. ' +
          'Her katmanda gömülü sır var mı, hangi dosyada ve hangi satırda? ' +
          'Ayrıca her katmanın sorumluluğunu ve katmanlar arası bağımlılıkları dosya:satır referansıyla çıkar.'
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

  const started = Date.now()
  await runWithWorkspace(base, () =>
    runAgent({
      requestId: `req-live-${Date.now()}`,
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
  const elapsed = Math.round((Date.now() - started) / 1000)

  const toolCalls = sink.events.filter((event) => event.type === 'tool-call') as Array<{
    call?: { name?: string; arguments?: string }
  }>
  const names = toolCalls.map((event) => event.call?.name ?? '?')
  const spawns = toolCalls.filter((event) => event.call?.name === 'spawn_agent')
  const subagentTasks = sink.events.filter((event) => event.type === 'subagent-task')

  const distribution: Record<string, number> = {}
  for (const name of names) distribution[name] = (distribution[name] ?? 0) + 1

  console.log(`\nsüre: ${elapsed} sn`)
  console.log(`araç çağrısı: ${names.length}`)
  console.log(`dağılım: ${JSON.stringify(distribution)}`)
  console.log(`spawn_agent: ${spawns.length}`)
  console.log(`subagent-task olayı: ${subagentTasks.length}`)
  for (const spawn of spawns.slice(0, 6)) {
    console.log(`  → ${String(spawn.call?.arguments).slice(0, 220)}`)
  }

  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  console.log(`\nnihai metin: ${text.length} karakter`)
  console.log(`sır bulundu mu: ${/CokGizli123|sifre-9876|tok_5f3a91b2c4d6e8/.test(text)}`)

  const reads = distribution['read_file'] ?? 0
  check('sırlar raporda (firmware)', /CokGizli123|sifre-9876/.test(text), true)
  check('sırlar raporda (bulut)', /tok_5f3a91b2c4d6e8/.test(text), true)
  check('sırlar raporda (araclar)', /py_token_9911aa/.test(text), true)
  check('makul sürede bitti (<300 sn)', elapsed < 300, true)
  // Strateji serbest: alt ajan, toplu okuma veya repo_map+grep kestirmesi —
  // hepsi meşru. Burada ölçülen şey **sonucun doğruluğu ve verimliliği**.
  const strategy =
    spawns.length > 0
      ? `alt ajan x${spawns.length}`
      : reads >= 40
        ? `toplu okuma x${reads}`
        : (distribution['grep'] ?? 0) > 0
          ? 'grep/repo_map kestirmesi'
          : 'doğrudan okuma'
  console.log(`\nstrateji: ${strategy}`)
  console.log(`alt ajan: ${spawns.length} · read_file: ${reads} · süre: ${elapsed} sn`)

  // Alt ajan kullanıldıysa sonuçları **boş olmamalı** (0.4.7 canlı kusuru).
  const spawnResults = sink.events.filter(
    (event) =>
      event.type === 'tool-result' &&
      (event as { result?: { name?: string } }).result?.name === 'spawn_agent'
  ) as Array<{ result?: { ok?: boolean; content?: string } }>
  if (spawns.length > 0) {
    check('alt ajan sonuçları boş değil', spawnResults.every((r) => r.result?.ok === true), true)
  }

  console.log(`\nTOTAL=5 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
