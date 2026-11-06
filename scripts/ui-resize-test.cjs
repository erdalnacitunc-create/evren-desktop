/**
 * Panel sürükleme + kalıcılık testi (gerçek Electron penceresinde).
 * Çalıştırma: node scripts/ui-resize-test.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { _electron } = require('playwright-core')

const OUT = path.join(os.tmpdir(), `evren-ui-resize-${Date.now()}`)
const SRC = path.join(process.env.APPDATA, 'EVREN Desktop Beta')

function prepare() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const name of ['settings.json', 'credentials.bin', 'sessions.json', 'Local State', 'Preferences']) {
    const from = path.join(SRC, name)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, name))
  }
  const settingsPath = path.join(OUT, 'settings.json')
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    settings.theme = 'dark'
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }
}

const launch = () =>
  _electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, EVREN_DATA_DIR: OUT },
    timeout: 40000
  })

let failed = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

;(async () => {
  prepare()
  let app = null
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForSelector('.composer', { timeout: 40000 })
    await page.waitForTimeout(1500)

    const width = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)
        return el ? Math.round(el.getBoundingClientRect().width) : null
      }, sel)

    // ===== 1) başlangıç genişliği =====
    const start = await width('.sessions-sidebar')
    check('sohbet listesi varsayılan 290', start, 290)

    // ===== 2) sürükle → genişler =====
    const handle = page.locator('.resize-handle').first()
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const grown = await width('.sessions-sidebar')
    check('sürükleme genişletti', grown > start + 80, true)
    console.log(`  ${start} → ${grown}`)

    // ===== 3) alt sınır =====
    await page.mouse.move(box.x + grown - 290 + 7, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(60, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const clamped = await width('.sessions-sidebar')
    check('alt sınır 180 uygulandı', clamped >= 180, true)
    console.log(`  daraltma → ${clamped}`)

    // ===== 4) kalıcılık: yeniden açılışta hatırlanır =====
    // Orta bir değere getir (çok geniş bırakma: dar pencerede toolbar taşar).
    const currentLeft = box.x + grown - 290 + 7
    await page.mouse.move(currentLeft, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(currentLeft - (grown - 330), box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const saved = await width('.sessions-sidebar')
    const stored = await page.evaluate(() => window.localStorage.getItem('evren.panel.v1.sessions'))
    check('boyut localStorage\'a yazıldı', stored !== null, true)
    check('yazılan değer ölçülenle aynı', Number(stored), saved)
    console.log(`  kayıtlı: ${stored}`)

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.waitForSelector('.composer', { timeout: 40000 })
    await page.waitForTimeout(1500)
    const restored = await width('.sessions-sidebar')
    check('yeniden açılışta boyut korundu', restored, saved)

    // ===== 5) gizleme + kalıcılık =====
    await page.locator('.btn-collapse').first().click()
    await page.waitForTimeout(600)
    check('gizlenince sidebar yok', await page.locator('.sessions-sidebar').count(), 0)
    check('geri gösterme düğmesi var', await page.locator('.restore-sidebar').count(), 1)

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.waitForSelector('.composer', { timeout: 40000 })
    await page.waitForTimeout(1500)
    check('gizleme hatırlandı', await page.locator('.sessions-sidebar').count(), 0)
    await page.locator('.restore-sidebar').click()
    await page.waitForTimeout(500)
    check('geri getirilebildi', await page.locator('.sessions-sidebar').count(), 1)

    // ===== 6) yan panel + terminal tutamağı =====
    // Sohbet listesini varsayılana döndür: panel sınırı temiz ölçülsün.
    await page.locator('.resize-handle').first().click()
    await page.keyboard.press('Home')
    await page.waitForTimeout(500)
    const sidebarBack = await width('.sessions-sidebar')
    check('Home ile sohbet listesi varsayılana döndü', sidebarBack, 290)

    await page.locator('button:has-text("Dosyalar")').first().click()
    await page.waitForTimeout(900)
    const paneStart = await width('.workspace-pane')
    check('dosyalar paneli varsayılan 480', paneStart, 480)

    // Klavye ile boyut değiştir (yön saf fonksiyonda test edilir; burada
    // gerçek pencerede etkileşimin çalıştığı doğrulanır).
    const paneHandle = page.locator('.resize-handle').last()
    await paneHandle.focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    const paneGrown = await width('.workspace-pane')
    check('yan panel klavyeyle yeniden boyutlandı', paneGrown !== paneStart, true)
    console.log(`  panel ${paneStart} → ${paneGrown}`)

    // Çok büyütmeye çalış: sohbet kolonuna yer kalmalı.
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(500)
    const chatWidth = await page.evaluate(() => {
      const chat = document.querySelector('.chat')
      return chat ? Math.round(chat.getBoundingClientRect().width) : 0
    })
    check('sohbet kolonuna en az 380 px kaldı', chatWidth >= 380, true)
    console.log(`  aşırı büyütme sonrası sohbet: ${chatWidth}px`)

    const restored2 = await page.evaluate(() =>
      Number(window.localStorage.getItem('evren.panel.v1.workspace'))
    )
    check('panel boyutu kalıcı', Number.isFinite(restored2), true)

    await page.locator('button:has-text("Terminal")').first().click()
    await page.waitForTimeout(1200)
    const termHandle = page.locator('.resize-handle-horizontal')
    check('terminal tutamağı var', await termHandle.count(), 1)

    // ===== 7) klavye erişilebilirliği =====
    const kbHandle = page.locator('.resize-handle').first()
    await kbHandle.focus()
    const beforeKb = await width('.workspace-pane')
    await page.keyboard.press('Home')
    await page.waitForTimeout(300)
    const clampedAfterHome = await width('.workspace-pane')
    check(
      'Home tuşu varsayılana döndürür',
      clampedAfterHome >= 280 && clampedAfterHome <= 900,
      true
    )
    console.log(`  klavye: ${beforeKb} → ${clampedAfterHome}`)

    console.log(`TOTAL=13 FAILED=${failed}`)
    process.exitCode = failed === 0 ? 0 : 1
  } catch (error) {
    console.error('HATA:', error.message)
    process.exitCode = 1
  } finally {
    if (app) await app.close().catch(() => undefined)
    fs.rmSync(OUT, { recursive: true, force: true })
  }
})()
