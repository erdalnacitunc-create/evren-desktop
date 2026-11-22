/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { modelGate } from '../src/main/agent/modelGate'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, ChatEvent } from '../src/shared/types'

/**
 * Eşzamanlılık kapısı — **gerçek model** ile canlı test (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/model-concurrency-live-test.ts
 *
 * ## Ne doğrular
 *
 * 0.4.24 canlı turu tam olarak burada düştü: sağlayıcı 2 eşzamanlı istek
 * veriyordu, biz 3 gönderdik. Sahte sunucu testi sayacı kanıtlar; bu test
 * **gerçek sağlayıcıyla** turun artık düşmediğini gösterir.
 *
 * Senaryo: kullanıcı mesajında masaüstündeki projenin yolu geçer ve alt ajan
 * istenir. Beklenen:
 *
 * 1. Tur `error` ile düşmez (ya normal biter ya `provider-busy` ile yumuşak kapanır).
 * 2. Hiçbir anda uçuştaki istek kapıyı aşmaz (kapı sayacı).
 * 3. Alt ajanlar dış yolu **okuyabildi** (0.4.24'te okuyamıyorlardı).
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

const MODEL = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'

let failed = 0
let total = 0
function check(label: string, actual: unknown, expected: unknown): void {
  total += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

function finish(): void {
  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
}

process.on('unhandledRejection', (reason) => {
  console.error('FAIL  beklenmeyen hata:', reason instanceof Error ? reason.stack : reason)
  failed += 1
  finish()
})

app.whenReady().then(async () => {
  const apiKey = await loadApiKey()
  const settings = await getSettings()
  if (!apiKey) {
    console.log('SKIP: API anahtarı yok — canlı test atlandı.')
    app.exit(0)
    return
  }

  // Dış proje: okunabilir olması gereken gerçek dosyalar.
  const outside = join(dataDir, 'live-outside-project')
  rmSync(outside, { recursive: true, force: true })
  mkdirSync(join(outside, 'src'), { recursive: true })
  writeFileSync(
    join(outside, 'src', 'ayar.ts'),
    "export const API_YOLU = '/durum'\nexport const MODEL = 'sonda'\n",
    'utf8'
  )
  writeFileSync(join(outside, 'README.md'), '# canlı dış proje\n\nBu proje test amaçlıdır.\n', 'utf8')

  // Çalışma alanı: boş geçici dizin (0.4.24'teki durumun aynısı).
  const workspace = join(dataDir, 'live-empty-workspace')
  rmSync(workspace, { recursive: true, force: true })
  mkdirSync(workspace, { recursive: true })

  const sink = createRecordingSink()
  const payload: ChatRequest = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content:
          `Şu projeyi incele: ${outside}\n` +
          'İki alt ajan başlat (explore): biri `src/ayar.ts` içindeki sabitleri, ' +
          'diğeri `README.md` içeriğini okusun. Sonra tek paragrafta özetle.'
      }
    ],
    agent: { enabled: true, mode: 'auto', profile: 'build', browser: false, computer: false, workspace: true }
  } as ChatRequest

  const startedAt = Date.now()
  await runWithWorkspace(workspace, () =>
    runAgent({
      requestId: `live-conc-${Date.now()}`,
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
  const seconds = Math.round((Date.now() - startedAt) / 1000)

  const events: ChatEvent[] = sink.events
  const text = events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  const errors = events.filter((event) => event.type === 'error')
  const done = events.find((event) => event.type === 'done') as
    | { finishReason: string }
    | undefined
  const spawned = events.filter((event) => event.type === 'subagent-task').length

  console.log(
    `  · ${seconds} sn · done=${done?.finishReason ?? 'yok'} · hata=${errors.length} · ` +
      `alt ajan olayı=${spawned} · kapı=${modelGate.maxConcurrent}`
  )

  check('tur hata ile düşmedi', errors.length, 0)
  check('tur kapandı', Boolean(done), true)
  check('kapı boş kaldı', modelGate.snapshot().active, 0)

  // Dış okuma: alt ajanlar masaüstündeki dosyayı görebildi mi?
  const readOutside = events.some((event) => {
    if (event.type !== 'tool-result') return false
    const result = (event as { result?: { name?: string; ok?: boolean; content?: string } }).result
    return (
      result?.ok === true &&
      (result.name === 'read_file' || result.name === 'grep' || result.name === 'glob') &&
      String(result.content ?? '').includes('sonda')
    )
  })
  check('alt ajan dış dosyayı okudu', readOutside, true)
  check('özet üretildi', text.trim().length > 80, true)

  finish()
})
