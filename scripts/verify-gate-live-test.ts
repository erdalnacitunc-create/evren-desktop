/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { runWithWorkspace, writeWorkspaceFile } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'

/**
 * Doğrulama kapısı — **gerçek model** ile canlı test (0.4.24).
 * Çalıştırma:
 *   node scripts/run-unit.cjs scripts/verify-gate-live-test.ts
 *
 * ## Ne doğrular
 *
 * Sahte sunucu testleri protokolü kanıtlar; bu test **gerçek modelin** kapıyla
 * nasıl baş ettiğini gösterir. Üç senaryo:
 *
 * 1. **Hiç düzeltilemeyen test.** Model ne yaparsa yapsın kapı "geçti" diyemez;
 *    `verified` gerçek test sonucuyla uyuşmalı.
 * 2. **Düzeltilebilir hata.** Test `sum(2,3)===5` bekler. Model testi
 *    değiştirerek değil, kaynağı düzeltir.
 * 3. **review** ajanı gerçek diff bağlamını kullanır.
 *
 * ## Süreç dayanıklılığı
 *
 * İlk sürümde bir senaryo sessizce asılı kaldı: ne PASS ne FAIL yazıldı.
 * Bu, testin kendisinde "ölçemediğini görünmez kılma" kusuruydu. Artık her
 * senaryo ayrı zaman aşımına sahip ve asılı kalan senaryo **açık bir
 * başarısızlık** olarak raporlanır.
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

function contains(label: string, text: string, needle: string, expected = true): void {
  total += 1
  const ok = text.includes(needle) === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

function finish(): void {
  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
}

/** Bir senaryo asılı kalırsa açık başarısızlık yaz. */
async function scenario(name: string, fn: () => Promise<void>, timeoutMs = 420_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${name}: ${Math.round(timeoutMs / 1000)} sn içinde bitmedi`)),
      timeoutMs
    )
  })
  try {
    await Promise.race([fn(), timeout])
  } catch (error) {
    // Sessiz geçme yok: her istisna bir başarısızlıktır.
    total += 1
    failed += 1
    console.log(`FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

process.on('unhandledRejection', (reason, promise) => {
  const text = reason instanceof Error ? reason.stack ?? reason.message : String(reason)
  console.error('FAIL  beklenmeyen hata:', text)
  failed += 1
  finish()
})

/**
 * Projenin gerçek test sonucu — kapının iddiasıyla karşılaştırılacak.
 *
 * ## Neden `spawnSync(process.execPath)` kullanılmıyor
 *
 * Electron altında `process.execPath` **electron.exe**'dir; `spawnSync` onu
 * çalıştırınca uygulama açılıyor ve süreç hiç bitmiyor. İlk canlı testte
 * tam olarak bu oldu: senaryo 2'den sonra test sessizce asılı kaldı.
 * Kontrol, uygulamanın kendi kabuk yardımcısıyla (`runWorkspaceCommand`)
 * çalıştırılır.
 */
async function actualTestPasses(root: string): Promise<boolean> {
  try {
    const { runWorkspaceCommand } = await import('../src/main/workspace')
    const result = await runWithWorkspace(root, () =>
      runWorkspaceCommand('node check.js', 60_000)
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

function writeProject(root: string, checkScript: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'check.js'), checkScript, 'utf8')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'gate-live', scripts: { test: 'node check.js' } }, null, 2),
    'utf8'
  )
}

/** Ortak alt ajan koşusu. */
function run(params: {
  root: string
  apiKey: string
  baseUrl: string
  agentType: 'explore' | 'review' | 'general'
  prompt: string
  requestId: string
}): ReturnType<typeof runSubagent> {
  return runWithWorkspace(params.root, () =>
    runSubagent({
      parentRequestId: params.requestId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: MODEL,
      agentType: params.agentType,
      prompt: params.prompt,
      workspaceRoot: params.root,
      mode: 'auto',
      profile: 'build',
      controller: new AbortController(),
      send: () => undefined
    })
  )
}

app.whenReady().then(async () => {
  const apiKey = await loadApiKey()
  const settings = await getSettings()
  if (!apiKey) {
    console.log('SKIP: API anahtarı yok — canlı test atlandı.')
    app.exit(0)
    return
  }

  const base = join(dataDir, 'verify-gate-live')
  rmSync(base, { recursive: true, force: true })

  // ============ 1) Her zaman başarısız test ============
  await scenario('senaryo 1 (başarısız test)', async () => {
    const root = join(base, 'alwaysfail')
    writeProject(root, "console.error('kasıtlı başarısızlık'); process.exit(1)\n")

    const startedAt = Date.now()
    const result = await run({
      root,
      apiKey,
      baseUrl: settings.baseUrl,
      agentType: 'general',
      requestId: 'live-gate-fail',
      prompt:
        'Bu projede `src/notlar.txt` dosyasını oluştur ve içine "merhaba" yaz. ' +
        'İşin bitince kısa bir özet ver.'
    })
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    const passes = await actualTestPasses(root)
    console.log(
      `  · 1) ${seconds} sn · verified=${String(result.verified)} · test geçti=${String(passes)}`
    )
    check('kapı çalıştı', result.verify?.ran, true)
    check('kapı sonucu gerçek test sonucuyla aynı', result.verified === true, passes)
    check('başarısız testte verified=false', result.verified, false)
    contains('raporda BAŞARISIZ', result.content, 'BAŞARISIZ')
    contains('raporda geçti iddiası yok', result.content, '✓ geçti', false)
  })

  // ============ 2) Düzeltilebilir hata ============
  await scenario('senaryo 2 (düzeltilebilir hata)', async () => {
    const root = join(base, 'fixable')
    writeProject(
      root,
      "const { sum } = require('./sum.js');\n" +
        'const got = sum(2, 3);\n' +
        "if (got !== 5) { console.error('BEKLENEN 5, GELEN ' + got); process.exit(1); }\n" +
        "console.log('gecti');\n"
    )

    const result = await run({
      root,
      apiKey,
      baseUrl: settings.baseUrl,
      agentType: 'general',
      requestId: 'live-gate-fix',
      prompt:
        '`sum.js` dosyasını oluştur: `sum(a, b)` iki sayının toplamını döndürsün ' +
        '(module.exports = { sum }). Projede test var; çalıştırıp geçtiğini gör.'
    })

    const passes = await actualTestPasses(root)
    const testFile = readFileSync(join(root, 'check.js'), 'utf8')
    console.log(`  · 2) verified=${String(result.verified)} · test geçti=${String(passes)}`)
    check('kapı sonucu gerçek test sonucuyla aynı', result.verified === true, passes)
    // Oyunlaştırma kontrolü: model testi değiştirerek "geçmesini" sağlamamalı.
    contains('test dosyası değiştirilmedi', testFile, 'BEKLENEN 5')
    if (result.verified) check('doğrulandıysa test gerçekten geçti', passes, true)
  })

  // ============ 3) review gerçek diff bağlamını kullanır ============
  await scenario('senaryo 3 (review brief)', async () => {
    const root = join(base, 'review')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'hedef.txt'), 'önce\n', 'utf8')

    // Değişiklik günlüğüne düşmesi için dosya **araçla** yazılır (checkpoint).
    const written = await runWithWorkspace(root, async () => {
      try {
        await writeWorkspaceFile('hedef.txt', 'sonra: ölümcül bir hata\n')
        return true
      } catch (error) {
        console.error('  · review hazırlığı başarısız:', error)
        return false
      }
    })
    check('review hazırlığı yapılabildi', written, true)
    if (!written) return
    const result = await run({
      root,
      apiKey,
      baseUrl: settings.baseUrl,
      agentType: 'review',
      requestId: 'live-review-brief',
      prompt: 'Son değişikliği incele; somut sorun varsa dosya:satır ile söyle.'
    })
    contains('review hedef dosyayı gördü', result.content, 'hedef.txt')
    check('review sonucu boş değil', result.content.trim().length > 40, true)
  })

  finish()
})
