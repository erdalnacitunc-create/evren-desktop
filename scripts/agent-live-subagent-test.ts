/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'

/**
 * Alt ajanı **doğrudan** gerçek modelle sınar.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-subagent-test.ts
 *
 * ## Neden doğrudan
 *
 * Ana ajanı alt ajan kullanmaya ikna etmek güvenilir bir test değil: model
 * `repo_map`/`grep` ile kestirme bulunca (ki bu doğru davranış) devretmiyor.
 * Bu test alt ajanı doğrudan çağırır ve tek şeyi ölçer:
 *
 *   **30 dosyalık içerik okuma görevinde alt ajan boş sonuç döndürüyor mu?**
 *
 * Canlı kusur: plc_proje koşusunda 4 ajanın 4'ü de adım limitine takılıp
 * boş metin döndürdü. Bu test o hatanın kapandığını doğrular.
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

function makeProject(base: string): void {
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'moduller'), { recursive: true })
  for (let index = 0; index < 30; index += 1) {
    writeFileSync(
      join(base, 'moduller', `birim${index}.ts`),
      [
        `// Birim ${index}: ${index % 3 === 0 ? 'kimlik doğrulama' : index % 3 === 1 ? 'veri erişimi' : 'raporlama'} katmanı`,
        `import { yardimci${index} } from "./yardimci${index}"`,
        `export function islem${index}(girdi: string): string {`,
        `  if (!girdi) return "bos-${index}"`,
        `  return girdi.toUpperCase() + "-${index}"`,
        `}`,
        `export const SABIT_${index} = ${index * 10}`,
        ''
      ].join('\n'),
      'utf8'
    )
  }
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'live-subagent')
  makeProject(base)
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(0)
    return
  }

  const model = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'
  const started = Date.now()

  const result = await runWithWorkspace(base, () =>
    runSubagent({
      parentRequestId: `req-live-sub-${Date.now()}`,
      baseUrl: settings.baseUrl,
      apiKey,
      model,
      agentType: 'explore',
      prompt:
        'moduller/ altındaki 30 .ts dosyasının İÇERİĞİNİ oku. ' +
        'Her dosyanın hangi katmana ait olduğunu (kimlik doğrulama / veri erişimi / raporlama) ' +
        've dışa aktardığı fonksiyonları dosya:satır ile listele. ' +
        'Katman başına kaç dosya olduğunu özetle.',
      workspaceRoot: base,
      mode: 'auto',
      profile: 'build',
      controller: new AbortController(),
      send: () => undefined
    })
  )
  const elapsed = Math.round((Date.now() - started) / 1000)

  const content = result.content.trim()
  const filesMentioned = new Set(
    (content.match(/birim\d+\.ts/g) ?? []).map((name) => name.toLowerCase())
  )

  console.log(`\nsüre: ${elapsed} sn`)
  console.log(`ok: ${result.ok}`)
  console.log(`sonuç uzunluğu: ${content.length} karakter`)
  console.log(`anılan dosya sayısı: ${filesMentioned.size}`)
  console.log(`katman ifadesi var mı: ${/kimlik doğrulama|veri erişimi|raporlama/i.test(content)}`)
  console.log('\n--- sonuç (ilk 500 karakter) ---')
  console.log(content.slice(0, 500))

  check('sonuç boş değil', content.length > 200, true)
  check('dosya referansı var', filesMentioned.size >= 5, true)
  check('katman sınıflandırması var', /kimlik doğrulama|veri erişimi|raporlama/i.test(content), true)
  check('ok=true', result.ok, true)
  check('eski limit metni yok', /adım limitine ulaştı/i.test(content), false)
  check('süre makul (<300 sn)', elapsed < 300, true)

  console.log(`\nTOTAL=6 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
