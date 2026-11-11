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
  mkdirSync(join(base, 'firmware'), { recursive: true })
  mkdirSync(join(base, 'mobil', 'lib'), { recursive: true })

  const headers = [
    'main', 'mqtt', 'api', 'kumanda', 'web', 'durum_coz', 'haier_kare',
    'kok_sertifika', 'tls_olc', 'mqtt_tani', 'ota', 'ayarlar', 'ag',
    'led', 'sensor', 'zamanlayici'
  ]
  for (const name of headers) {
    writeFileSync(
      join(base, 'firmware', `${name}.h`),
      [
        `// ${name} modulu`,
        `#define ${name.toUpperCase()}_PORT 1883`,
        `const char* ${name.toUpperCase()}_HOST = "broker.example.local";`,
        `// TODO: sabitleri ayarlar.h'a tasi`,
        `struct ${name}_t { int aktif; int hata; };`,
        ''
      ].join('\n'),
      'utf8'
    )
  }

  // Bilinçli gömülü sırlar: alt ajanın bulması gereken şey.
  writeFileSync(
    join(base, 'firmware', 'ayarlar.h'),
    [
      '// yapilandirma',
      'static const char* WIFI_SSID = "klima-ag-5g";',
      'static const char* WIFI_SIFRE = "CokGizli123!";',
      'static const char* MQTT_KULLANICI = "esp-klima";',
      'static const char* MQTT_PAROLA = "sifre-9876";',
      'static const char* API_TOKEN = "tok_5f3a91b2c4d6e8";',
      ''
    ].join('\n'),
    'utf8'
  )

  for (let index = 0; index < 7; index += 1) {
    writeFileSync(
      join(base, 'mobil', 'lib', `ekran${index}.dart`),
      `// ekran ${index}\nconst apiYolu = "/api/v1/durum";\nclass Ekran${index} { int deger = ${index}; }\n`,
      'utf8'
    )
  }

  writeFileSync(
    join(base, 'README.md'),
    '# Klima koprusu\n\nESP firmware + Flutter mobil uygulama.\n',
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
          'firmware/ klasöründeki tüm .h dosyalarının İÇERİĞİNİ oku. Gömülü sırları ' +
          '(Wi-Fi şifresi, MQTT parolası, API token) ve protokol sabitlerini dosya:satır ile listele.'
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

  check('alt ajan tetiklendi', spawns.length > 0, true)
  check('sırlar raporda', /CokGizli123|sifre-9876|tok_5f3a91b2c4d6e8/.test(text), true)

  console.log(`\nTOTAL=2 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
