/**
 * Electron uçtan uca duman testi.
 * - İzole geçici veri dizini kullanır (kullanıcı verisine dokunmaz).
 * - Sandbox + contextIsolation + preload yüzeyini doğrular.
 * - Pencere/arayüz açılışını ve pano iznini kontrol eder.
 *
 * Çalıştırma: npm run test:e2e
 * Gerekli: EVREN_LLM_API_KEY (veya geçici dizinde kayıtlı anahtar)
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { _electron } = require('playwright-core')

;(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-e2e-'))
  const errors = []
  let app = null

  try {
    const apiKey = process.env.EVREN_API_KEY || process.env.EVREN_LLM_API_KEY
    app = await _electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        EVREN_DATA_DIR: dataDir,
        ...(apiKey ? { EVREN_API_KEY: apiKey } : {})
      },
      timeout: 30_000
    })

    const page = await app.firstWindow()
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 300))
    })
    page.on('pageerror', (error) => errors.push(`PAGEERROR ${error.message}`))

    await page.waitForSelector('textarea', { timeout: 30_000 })
    assert.strictEqual(await page.title(), 'EVREN Desktop')

    const ping = await page.evaluate(() => window.evren.ping())
    assert.strictEqual(ping.ok, true)
    assert.strictEqual(ping.app, 'EVREN Desktop')

    const isolation = await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      evren: typeof window.evren
    }))
    assert.deepStrictEqual(isolation, {
      require: 'undefined',
      process: 'undefined',
      evren: 'object'
    })

    const workspace = await page.evaluate(() => window.evren.workspace.get())
    assert.strictEqual(workspace.ok, true)

    const clipboard = await page.evaluate(async () => {
      try {
        await navigator.clipboard.writeText('evren-e2e')
        return true
      } catch {
        return false
      }
    })
    assert.strictEqual(clipboard, true)

    const shell = await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process
    }))
    assert.deepStrictEqual(shell, { require: 'undefined', process: 'undefined' })

    assert.deepStrictEqual(errors, [])
    console.log(
      `E2E OK · title=EVREN Desktop · preload=object · require=${isolation.require} · process=${isolation.process} · clipboard=${clipboard}`
    )
  } finally {
    if (app) await app.close().catch(() => undefined)
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(`E2E FAIL: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})
