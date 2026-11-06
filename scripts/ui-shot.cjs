/**
 * Arayüz ekran görüntüsü aracı.
 *
 * Gerçek kullanıcı verisini **değiştirmez**: mevcut beta profilinin yalnızca
 * gerekli dosyaları geçici bir dizine kopyalanır, uygulama orada açılır.
 *
 * Çalıştırma: node scripts/ui-shot.cjs <çıktı-dizini>
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { _electron } = require('playwright-core')

const OUT = process.argv[2] || path.join(os.tmpdir(), 'evren-ui')
const SRC = path.join(process.env.APPDATA, 'EVREN Desktop Beta')

const COPY = [
  'settings.json',
  'credentials.bin',
  'sessions.json',
  'session-events.jsonl',
  'github-token.bin',
  'github-app-key.bin',
  '.updaterId',
  'window-state.json',
  'Local State',
  'Preferences'
]

function prepare() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const name of COPY) {
    const from = path.join(SRC, name)
    if (!fs.existsSync(from)) continue
    fs.copyFileSync(from, path.join(OUT, name))
  }
  const memoryFrom = path.join(SRC, 'memory')
  if (fs.existsSync(memoryFrom)) {
    fs.cpSync(memoryFrom, path.join(OUT, 'memory'), { recursive: true })
  }
  // Testte temayı sabitle: varsayılan "sistem" teması makineden makineye
  // değişir, ekran görüntüleri karşılaştırılamaz olur.
  const settingsPath = path.join(OUT, 'settings.json')
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    settings.theme = process.env.UI_THEME || 'dark'
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }
  return OUT
}

;(async () => {
  const dataDir = prepare()
  let app = null
  try {
    app = await _electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, EVREN_DATA_DIR: dataDir },
      timeout: 40_000
    })
    const page = await app.firstWindow()
    await page.waitForSelector('textarea, .composer', { timeout: 40_000 })
    await page.waitForTimeout(2500)

    // İlk sohbeti aç (mesaj geçmişi olan).
    const sessions = page.locator('.session-item')
    const count = await sessions.count()
    if (count > 0) {
      await sessions.nth(0).click()
      await page.waitForTimeout(1800)
    }

    await page.screenshot({ path: path.join(OUT, '01-default.png') })

    // Besteci: çok satırlı metin → 5 satır sınırı.
    const textarea = page.locator('.composer-box textarea')
    if (await textarea.count()) {
      await textarea.fill(
        'uzun bir metin satırı\nikinci satır\nüçüncü satır\ndördüncü satır\nbeşinci satır\naltıncı satır\nyedinci satır'
      )
      await page.waitForTimeout(600)
      const box = await textarea.boundingBox()
      console.log('textarea yüksekliği (7 satır):', box && Math.round(box.height))
      await page.screenshot({ path: path.join(OUT, '02-composer-multiline.png') })
      await textarea.fill('')
    }

    // Yan panel + tutamak.
    await page.locator('button:has-text("Dosyalar")').first().click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(OUT, '03-sidepanel.png') })

    const handles = await page.locator('.resize-handle').count()
    console.log('tutamaç sayısı:', handles)

    // Sohbet listesini gizle.
    await page.locator('.btn-collapse').first().click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(OUT, '04-sidebar-hidden.png') })

    console.log('OK →', OUT)
  } catch (error) {
    console.error('HATA:', error.message)
    process.exitCode = 1
  } finally {
    if (app) await app.close().catch(() => undefined)
  }
})()
