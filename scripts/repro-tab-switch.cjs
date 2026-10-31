/**
 * Sekme değişimi reprodüksiyonu — tamamen arayüz üzerinden, sunucu ayrı süreçte.
 *
 * Akış: yeni sohbet → mesaj yaz → gönder (yavaş SSE) → başka sohbete geç →
 * geri dön. Akışın hayatta kalıp kalmadığını ölçer.
 *
 * Çalıştırma: node scripts/repro-tab-switch.cjs [--agent]
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { _electron } = require('playwright-core')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const agentMode = process.argv.includes('--agent')

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'fake-llm-server.cjs')], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let port = null
    const lines = []
    child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue
        lines.push(line.trim())
        const match = /^PORT=(\d+)$/.exec(line.trim())
        if (match && !port) {
          port = Number(match[1])
          resolve({ child, port, lines })
        }
      }
    })
    child.stderr.on('data', (chunk) => process.stderr.write('SERVER ERR ' + chunk))
    child.on('exit', (code) => {
      if (!port) reject(new Error('sunucu başlamadı, kod=' + code))
    })
    setTimeout(() => {
      if (!port) reject(new Error('sunucu zaman aşımı'))
    }, 10_000)
  })
}

;(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-repro-'))
  const { child: server, port, lines } = await startServer()

  fs.writeFileSync(
    path.join(dataDir, 'settings.json'),
    JSON.stringify(
      { baseUrl: `http://127.0.0.1:${port}`, agentMode: 'auto', workspaceTools: true, locale: 'tr' },
      null,
      2
    )
  )

  let app = null
  try {
    app = await _electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, EVREN_DATA_DIR: dataDir, EVREN_API_KEY: 'test-key', EVREN_AGENT_PROCESS: '' },
      timeout: 40_000
    })

    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForSelector('textarea', { timeout: 30_000 })

    // --- 1) A sohbeti ---
    await page.click('.btn-new')
    await sleep(800)
    if (agentMode) {
      await page.click('button:has-text("Ajan")')
      await sleep(300)
    }
    await page.fill('textarea', 'sekme testi A')
    await page.keyboard.press('Enter')
    console.log('A isteği gönderildi (agent=' + agentMode + ')')
    await sleep(1500)

    const duringA = await page.evaluate(() => ({
      streaming: !!document.querySelector('.btn-stop'),
      live: document.querySelectorAll('.session-live').length
    }))
    console.log('A sırasında:', JSON.stringify(duringA))

    // --- 2) B sohbetine geç (A çalışırken) ---
    await page.click('.btn-new')
    await sleep(1200)
    const onB = await page.evaluate(() => ({
      streaming: !!document.querySelector('.btn-stop'),
      live: document.querySelectorAll('.session-live').length
    }))
    console.log('B açık:', JSON.stringify(onB))

    // --- 3) A'ya dön ---
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.session-item'))
      const target = items.find((item) => item.innerText.includes('sekme testi A'))
      target?.click()
    })
    await sleep(1000)
    const onReturn = await page.evaluate(() => ({
      streaming: !!document.querySelector('.btn-stop'),
      live: document.querySelectorAll('.session-live').length,
      bodyTail: document.body.innerText.replace(/\s+/g, ' ').slice(-160)
    }))
    console.log("A'ya dönüş:", JSON.stringify(onReturn))

    // --- 4) akış bitene kadar bekle ---
    await sleep(5000)

    const after = await page.evaluate(() => ({
      streaming: !!document.querySelector('.btn-stop'),
      live: document.querySelectorAll('.session-live').length,
      bodyTail: document.body.innerText.replace(/\s+/g, ' ').slice(-200)
    }))
    console.log('bekleme sonrası:', JSON.stringify(after))

    const final = await page.evaluate(async () => {
      const list = await window.evren.sessions.list()
      const sessions = list.ok ? list.data : []
      const target = sessions.find((s) => s.title.includes('sekme testi A'))
      const detail = target ? await window.evren.sessions.get(target.id) : null
      return {
        sessions: sessions.map((s) => ({ title: s.title, count: s.messageCount })),
        messages:
          detail && detail.ok
            ? detail.data.messages.map((m) => ({ role: m.role, len: m.content.length, text: m.content.slice(0, 40) }))
            : null
      }
    })

    console.log('\n--- SONUÇ ---')
    console.log('oturumlar:', JSON.stringify(final.sessions))
    console.log('A mesajları:', JSON.stringify(final.messages))
    const serverTrace = lines.filter((line) => line.startsWith('CHUNK') || line.startsWith('CLOSE'))
    console.log('sunucu izleri:', serverTrace.length ? serverTrace.join(' | ') : '(yok)')
    if (pageErrors.length) console.log('sayfa hataları:', pageErrors.slice(0, 3))

    const assistant = (final.messages || []).find((m) => m.role === 'assistant')
    console.log(
      assistant
        ? `\n>>> ASİSTAN KAYDEDİLDİ (${assistant.len} karakter)`
        : '\n>>> ASİSTAN KAYDI YOK — AKIŞ KAYBOLDU'
    )
    const closed = serverTrace.some((line) => line.startsWith('CLOSE'))
    console.log(closed ? '>>> SUNUCU: bağlantı kapandı (akış kesildi)' : '>>> SUNUCU: bağlantı açık kaldı')
  } finally {
    if (app) await app.close().catch(() => undefined)
    server.kill()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error('REPRO FAIL:', error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
