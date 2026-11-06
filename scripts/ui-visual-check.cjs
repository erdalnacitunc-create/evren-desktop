const fs = require('fs')
const os = require('os')
const path = require('path')
const { _electron } = require('playwright-core')

const OUT = path.join(os.tmpdir(), `evren-ui-visual-${Date.now()}`)
const SRC = path.join(process.env.APPDATA, 'EVREN Desktop Beta')

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  for (const name of ['settings.json', 'credentials.bin', 'sessions.json', 'Local State', 'Preferences']) {
    const from = path.join(SRC, name)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, name))
  }
  const sp = path.join(OUT, 'settings.json')
  if (fs.existsSync(sp)) {
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'))
    s.theme = 'dark'
    fs.writeFileSync(sp, JSON.stringify(s, null, 2), 'utf8')
  }

  let app = null
  try {
    app = await _electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, EVREN_DATA_DIR: OUT },
      timeout: 40000
    })
    const page = await app.firstWindow()
    await page.waitForSelector('.composer', { timeout: 40000 })
    // Geniş pencere: sürüklemenin gerçekten büyüdüğünü ölçmek için test
    // penceresini büyüt (kullanıcı tercihi değil, test kurulumu).
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.setSize(1600, 950)
    })
    await page.waitForTimeout(1400)

    const w = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)
        return el ? Math.round(el.getBoundingClientRect().width) : 0
      }, sel)

    await page.locator('button:has-text("Dosyalar")').first().click()
    await page.waitForTimeout(900)
    console.log('panel başlangıç:', await w('.workspace-pane'))

    // Gerçek mouse sürükleme: tutamağı sola çek.
    const handle = page.locator('.resize-handle').last()
    const box = await handle.boundingBox()
    console.log('tutamak kutusu:', box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) })
    await page.mouse.move(box.x + box.width / 2, box.y + 200)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(box.x + box.width / 2 - step * 20, box.y + 200)
    }
    await page.mouse.up()
    await page.waitForTimeout(500)
    const after = await w('.workspace-pane')
    console.log('panel sürükleme sonrası:', after)
    await page.screenshot({ path: path.join(OUT, 'panel-dragged.png') })

    // Klavye: sol ok 4 kez
    await handle.focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    console.log('klavye sonrası:', await w('.workspace-pane'))
    await page.screenshot({ path: path.join(OUT, 'panel-keyboard.png') })

    // Terminal aç + yükseklik tutamağı
    await page.locator('button:has-text("Terminal")').first().click()
    await page.waitForTimeout(1400)
    await page.screenshot({ path: path.join(OUT, 'terminal.png') })
    console.log('terminal yüksekliği:', await page.evaluate(() => {
      const el = document.querySelector('.terminal-panel')
      return el ? Math.round(el.getBoundingClientRect().height) : 0
    }))
    console.log('OUT:', OUT)
  } catch (e) {
    console.error('HATA:', e.message)
  } finally {
    if (app) await app.close().catch(() => undefined)
  }
})()
