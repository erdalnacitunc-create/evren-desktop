/// <reference types="node" />
/**
 * Kurulu EVREN Desktop üzerinde **gerçek tur** canlı sınaması (0.4.25).
 * Çalıştırma: node scripts/installed-live-turn.mjs
 *
 * ## Ne yapar
 *
 * 1. Uygulamayı `EVREN_MODEL_CONCURRENCY=1` ile başlatır (kapı en sıkı).
 * 2. CDP ile arayüze bağlanır, yeni sohbet açar, istemi yazar.
 * 3. **Enter** ile gönderir (gerçek klavye olayı; React sentetik tıklamayı
 *    yutabiliyor — ilk denemede tam bu oldu ve tur hiç başlamadı).
 * 4. Gönderimin gerçekten başladığını doğrular (kullanıcı balonu + Durdur).
 * 5. Tur boyunca **canlı** izler ve uygulamanın kendi günlüğünden kanıt toplar.
 *
 * ## Ölçüm kuralı
 *
 * "Gönderdim" demek yetmez; **ekranda kullanıcı mesajı görünmeli**. Aksi hâlde
 * test hiçbir şey sınamadan "geçti" diyebilir — kapatmaya çalıştığımız sınıf.
 */
import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const PORT = 9333
const APP = 'C:\\Program Files\\EVREN Desktop\\EVREN Desktop.exe'
const PROFILE = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const MAIN_LOG = join(PROFILE, 'logs', 'main.log')
const SUB_LOG = join(PROFILE, 'logs', 'subagent-events.jsonl')
const SESSION_LOG = join(PROFILE, 'session-events.jsonl')
const EXT_DIR = join(process.env.USERPROFILE ?? 'C:\\Users\\erdal', 'Desktop', 'evren-desktop-beta')

const PROMPT =
  `Şu projeyi incele: ${EXT_DIR}\n` +
  'İki alt ajan başlat (explore): biri `src/main/agent/modelGate.ts` dosyasındaki ' +
  'kısıtları, diğeri `src/main/agent/readRoots.ts` dosyasındaki kuralları okusun. ' +
  'Sonra 3 maddede özetle. Okumadığın hiçbir şeyi iddia etme.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
let total = 0
function check(label, actual, expected) {
  total += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

function countLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').length
  } catch {
    return 0
  }
}
function since(path, offset) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .slice(offset)
      .filter((line) => line.trim())
  } catch {
    return []
  }
}

/**
 * Oturum olay günlüğünden tur durumunu okur.
 *
 * ## Neden bu kaynak
 *
 * Düğme başlığıyla "çalışıyor mu" tahmin etmek kırılgan: ilk denemede
 * `title === 'Durdur'` hiç eşleşmedi ve betik turu 20 sn'de bitmiş sandı.
 * Uygulamanın **kendi** olay günlüğü (`session-events.jsonl`) ise tur
 * sınırlarını açıkça yazar: `assistant.started`, `assistant.completed`,
 * `assistant.failed`, `retry.scheduled`.
 *
 * Bu, "ölçümü sistemin dışından yap" ilkesinin bu uygulamadaki karşılığı:
 * test kendi varsayımına değil, ürünün yaydığı olaya bakar.
 */
function readTurnState(offset) {
  const lines = since(SESSION_LOG, offset)
  const state = {
    started: false,
    completed: false,
    failed: false,
    retries: 0,
    error: '',
    retryReasons: []
  }
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'assistant.started') state.started = true
      if (event.type === 'assistant.completed') state.completed = true
      if (event.type === 'assistant.failed') {
        state.failed = true
        state.error = String(event.data?.error ?? '').slice(0, 200)
      }
      if (event.type === 'retry.scheduled') {
        state.retries += 1
        const reason = String(event.data?.error?.message ?? '')
        if (reason) state.retryReasons.push(reason)
      }
    } catch {
      // yarım satır
    }
  }
  return state
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data)
    if (data.id && pending.has(data.id)) {
      const entry = pending.get(data.id)
      pending.delete(data.id)
      data.error ? entry.reject(new Error(JSON.stringify(data.error))) : entry.resolve(data.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id
      pending.set(messageId, { resolve, reject })
      socket.send(JSON.stringify({ id: messageId, method, params }))
    })
  return { send, close: () => socket.close() }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

/** Gerçek klavye olayı: React'in kendi dinleyicileri tetiklenir. */
async function pressEnter(client) {
  const base = { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: '\r' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

async function main() {
  if (!existsSync(APP)) {
    console.log('HATA: kurulu uygulama yok')
    process.exit(1)
  }

  spawn('taskkill', ['/F', '/IM', 'EVREN Desktop.exe'], { stdio: 'ignore' })
  await sleep(2500)

  const mainBefore = countLines(MAIN_LOG)
  const subBefore = countLines(SUB_LOG)
  const sessionBefore = countLines(SESSION_LOG)

  console.log('· uygulama başlatılıyor (EVREN_MODEL_CONCURRENCY=1)')
  const child = spawn(APP, ['--remote-debugging-port=9333', '--remote-allow-origins=*'], {
    env: { ...process.env, EVREN_MODEL_CONCURRENCY: '1', EVREN_ABORT_GRACE_MS: '250' },
    detached: false,
    stdio: 'ignore'
  })

  let page = null
  const cdpDeadline = Date.now() + 45_000
  while (Date.now() < cdpDeadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((item) => item.type === 'page' && item.url.includes('index.html'))
      if (page) break
    } catch {
      // henüz
    }
    await sleep(500)
  }
  check('CDP bağlandı', Boolean(page), true)
  if (!page) {
    child.kill()
    console.log(`TOTAL=${total} FAILED=${failed}`)
    process.exit(1)
  }

  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable')

  console.log('· yeni sohbet')
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((el) => (el.title || el.getAttribute('aria-label') || '') === 'Yeni sohbet')
      if (button) button.click()
      return true
    })()`
  )
  await sleep(1500)

  // Metin alanını açıkça odakla (Enter'ın doğru yere gitmesi için).
  const focused = await evaluate(
    client,
    `(() => {
      const area = document.querySelector('textarea')
      if (!area) return { ok: false }
      area.focus()
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set
      setter.call(area, ${JSON.stringify(PROMPT)})
      area.dispatchEvent(new Event('input', { bubbles: true }))
      area.setSelectionRange(area.value.length, area.value.length)
      return { ok: true, length: area.value.length, active: document.activeElement === area }
    })()`
  )
  check('istem yazıldı', focused?.ok, true)
  check('metin alanı odakta', focused?.active, true)
  check('istem uzunluğu doğru', focused?.length, PROMPT.length)
  await sleep(500)

  console.log('· Enter ile gönderiliyor')
  await pressEnter(client)

  // Gönderim gerçekten başladı mı? Kullanıcı balonu belirmeli.
  const sent = await (async () => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const state = await evaluate(
        client,
        `(() => {
          const text = document.body.innerText
          return {
            hasPrompt: text.includes('modelGate.ts') && text.includes('readRoots.ts'),
            stopped: Boolean(
              [...document.querySelectorAll('button')].find((el) => (el.title || '') === 'Durdur')
            ),
            textareaEmpty: (document.querySelector('textarea')?.value ?? '').length === 0
          }
        })()`
      ).catch(() => ({ hasPrompt: false, stopped: false, textareaEmpty: false }))
      if (state.hasPrompt || state.stopped) return state
      await sleep(500)
    }
    return { hasPrompt: false, stopped: false, textareaEmpty: false }
  })()

  check('gönderim başladı (istem ekranda)', sent.hasPrompt || sent.stopped, true)
  check('metin alanı temizlendi', sent.textareaEmpty, true)

  // ---- CANLI İZLEME ----
  console.log('\n· canlı izleme (en fazla 7 dk)\n')
  const startedAt = Date.now()
  const seen = { spawn: 0, errors: 0, verify: 0, busy: 0, reads: 0 }
  let lastLine = ''
  let finished = false
  let lastText = ''

  while (Date.now() - startedAt < 420_000) {
    /**
     * Ölçüm: her yoklamada TÜM olaylar yeniden sayilir, bu yüzden sayaçlar
     * burada sifirlanmali.
     *
     * Bulunan kusur (bu betigin ilk sürümü): seen.reads sifirlanmiyordu; her
     * saniye tüm geçmis yeniden sayildigi için deger sisti (801 okuma
     * gösterdi; gerçek sayi 2). Ölçüm araci, ölçtügünü sandigi seyi
     * ölçmüyordu. Artik her alan her turda sifirlanir ve gerçek sayi
     * günlükten ayrica dogrulanir.
     */
    const events = since(SUB_LOG, subBefore)
    seen.spawn = 0
    seen.errors = 0
    seen.verify = 0
    seen.reads = 0
    const spawnedTags = new Set()
    for (const line of events) {
      try {
        const event = JSON.parse(line)
        if (event.phase === 'spawn') spawnedTags.add(event.taskId ?? event.msg)
        if (event.level === 'error') seen.errors += 1
        if (event.phase === 'verify') seen.verify += 1
        if (
          event.phase === 'tool' &&
          event.data?.ok === true &&
          ['read_file', 'grep', 'glob'].includes(event.data?.tool)
        ) {
          seen.reads += 1
        }
      } catch {
        // yarım satır
      }
    }
    seen.spawn = spawnedTags.size

    const mainEvents = since(MAIN_LOG, mainBefore)
    seen.busy = mainEvents.filter(
      (line) => line.includes('Sağlayıcı doygun') || line.includes('429')
    ).length

    const turn = readTurnState(sessionBefore)
    const state = await evaluate(
      client,
      `(() => {
        const text = document.body.innerText
        return {
          busy: text.includes('Sağlayıcı şu an dolu') || text.includes('en fazla 2 eşzamanlı'),
          text: text.slice(-600)
        }
      })()`
    ).catch(() => ({ busy: false, text: '' }))
    lastText = state.text

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(0)
    const phase = turn.completed
      ? 'tamam'
      : turn.failed
        ? 'HATA'
        : turn.started
          ? 'çalışıyor'
          : 'başlamadı'
    const line =
      `[${seconds}s] ${phase} · alt ajan=${seen.spawn} okuma=${seen.reads} ` +
      `hata=${seen.errors} doğrulama=${seen.verify} retry=${turn.retries}`
    if (line !== lastLine) {
      console.log(`   · ${line}`)
      lastLine = line
    }

    if (state.busy) {
      finished = true
      console.log('   · TUR DOYGUNLUK İLE KAPANDI (yumuşak kapanış)')
      break
    }
    if (turn.failed) {
      finished = true
      console.log(`   · TUR HATA İLE KAPANDI: ${turn.error}`)
      break
    }
    if (turn.completed) {
      finished = true
      console.log('   · tur tamamlandı (assistant.completed)')
      break
    }
    await sleep(1000)
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000)
  console.log(`\n=== sonuç: ${seconds} sn ===`)
  console.log('--- ekranın son 700 karakteri ---')
  console.log(lastText)

  const finalTurn = readTurnState(sessionBefore)
  console.log(
    `   tur: started=${finalTurn.started} completed=${finalTurn.completed} failed=${finalTurn.failed} retry=${finalTurn.retries}`
  )
  check('tur tamamlandı', finalTurn.completed, true)
  check('tur hata ile düşmedi', finalTurn.failed, false)
  check('429 kaynaklı yeniden deneme yok', finalTurn.retries, 0)
  check('kapı tuttu (doygunluk/429 yok)', seen.busy === 0 && !lastText.includes('Sağlayıcı şu an dolu'), true)
  check('en az bir alt ajan çalıştı', seen.spawn >= 1, true)
  /**
   * Gerçek sayim: tool.result olaylarini BIR KEZ say (döngüdeki yeniden
   * sayim yok). "Okuma yapildi mi" sorusunun kesin kaniti.
   */
  const realEvents = since(SESSION_LOG, sessionBefore)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const realToolResults = realEvents
    .filter((event) => event.type === 'tool.result')
    .map((event) => ({
      name: event.data?.name,
      ok: event.data?.ok,
      content: String(event.data?.content ?? '')
    }))
  const successfulReads = realToolResults.filter(
    (item) => item.ok === true && ['read_file', 'grep', 'glob'].includes(item.name)
  ).length
  const failedTools = realToolResults.filter((item) => item.ok === false).length
  const spawnCalls = realEvents.filter(
    (event) => event.type === 'tool.called' && event.data?.name === 'spawn_agent'
  ).length

  console.log(
    `   gerçek sayım: spawn_agent=${spawnCalls} · başarılı okuma=${successfulReads} · ` +
      `başarısız araç=${failedTools}`
  )

  check('alt ajanlar dosya okudu', successfulReads >= 1, true)
  check('başarısız araç çağrısı yok', failedTools, 0)
  check('en az bir alt ajan istendi', spawnCalls >= 1, true)

  child.kill()
  client.close()
  await sleep(1500)

  console.log(`\nTOTAL=${total} FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('HATA:', error.message)
  process.exit(1)
})
