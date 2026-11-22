/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { modelGate } from '../src/main/agent/modelGate'
import { runWithWorkspace } from '../src/main/workspace'
import type { ChatRequest } from '../src/shared/types'

/**
 * Model istek kapısı — **yük/kaos** sınaması (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/model-gate-stress-test.ts
 *
 * ## Yöntem (araştırmaya dayalı)
 *
 * Chaos Engineering ilkeleri (principlesofchaos.org):
 *  - "Steady state" **sistemin dışında** ölçülür, iç sayaçlarla değil.
 *  - Hipotez: yük/kaos altında da steady state korunur; onu çürütmeye çalış.
 *  - Gerçek olayları taklit et: yığın (burst), iptal, 429, uzun koşu.
 *
 * k6 stress testi sırası: smoke → average → stress → soak.
 *
 * Bu yüzden:
 *  - `inflight` **HTTP sunucusunda** sayılır (kapının kendi sayacı yalnızca
 *    raporlanır, doğrulamada kullanılmaz). Kendi kendini ölçen bir kapı,
 *    kendi hatasını gizleyebilir — 0.4.24'te tam bu sınıf bir kusur yaşandı.
 *  - Yalnızca "≤ N" yetmez: **N'e ulaşıldığı** da kanıtlanır. Aksi hâlde
 *    eşzamanlılığı 1'e düşüren bir hata testi "geçerdi".
 *  - Açlık (starvation) aranır: başlatılan her ajan sunucuya ulaşmalı.
 *  - Sızıntı aranır: bitişte aktif slot ve bekleyen kuyruk sıfır olmalı.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

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
/**
 * Eşik kontrolü — **gerçek değeri her zaman** yazar.
 *
 * Neden: ilk koşuda "eşzamanlılık (≤ 2) başarısız" satırı vardı ama kaç
 * olduğu yazmıyordu. Ölçüm aracı, ölçtüğü değeri göstermiyorsa tanılama
 * yapılamaz; bu da kapatmaya çalıştığımız sınıfın bir türü.
 */
function atMost(label: string, actual: number, limit: number): void {
  total += 1
  const ok = actual <= limit
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ölçülen ${actual}, sınır ${limit}`)
}
function atLeast(label: string, actual: number, limit: number): void {
  total += 1
  const ok = actual >= limit
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ölçülen ${actual}, beklenen ≥ ${limit}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Koşul sağlanana kadar bekle (yoklama).
 *
 * Sabit `sleep` ile zamanlama tahmin etmek, testleri makine hızına bağlı
 * hâle getirir. Durumu **gözlemlemek** daha güvenilir.
 */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(10)
  }
  return false
}
const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface ServerStats {
  /**
   * Ham sayaç: her istek başında +1, soket kapandığında/yanıt bittiğinde -1.
   * **Yalnızca tanılama** için; iptal edilen soketlerin kapanması birkaç ms
   * gecikebildiği için anlık değeri yanıltıcıdır.
   */
  inflight: number
  /** Ham sayacın gördüğü en yüksek değer (tanılama). */
  rawMax: number
  /**
   * Ana ölçüm: **yazar kasan** bağlantılar. Soketi kapanmış (iptal edilmiş)
   * istekler düşülür; sağlayıcının gerçekten iş sayacağı küme budur.
   */
  liveCount: number
  /** Yaşayan bağlantıların en yüksek eşzamanlılığı (ana ölçüm). */
  maxInflight: number
  /**
   * 20 ms'de bir örnekleyicinin gördüğü en yüksek değer.
   *
   * Ham sayaç gibi mikro saniyelik yanlış okumalara açık değildir; 20 ms'den
   * uzun süren her gerçek ihlali yakalar. "Gerçekten sınır aşıldı mı"
   * sorusunun ikinci ve bağımsız kanıtıdır.
   */
  sampledMax: number
  requests: number
  /** İstemci tarafından erken kapatılan istek sayısı (iptal). */
  aborted: number
  /** Aşım anında kaç canlının soketi zaten kapalıydı (kanıt). */
  overshootFromClosed: number
  /** İstek varış sırası: ajan etiketi. */
  arrivals: string[]
  /** Bu sunucuda enjekte edilecek 429 sayısı. */
  inject429: number
}

function startServer(options: {
  delayMs?: number
  /** İstek gövdesindeki "AJAN:<etiket>" işaretini varış sırasına yazar. */
  tagRequests?: boolean
} = {}): Promise<{
  server: ReturnType<typeof createServer>
  port: number
  stats: ServerStats
  stop: () => Promise<void>
  reset: () => void
  drain: (timeoutMs?: number) => Promise<void>
  setDelay: (ms: number) => void
}> {
  const stats: ServerStats = {
    inflight: 0,
    rawMax: 0,
    liveCount: 0,
    maxInflight: 0,
    sampledMax: 0,
    requests: 0,
    aborted: 0,
    overshootFromClosed: 0,
    arrivals: [],
    inject429: 0
  }
  /**
   * Senaryo başına ayarlanabilir gecikme.
   *
   * Neden: öncelik senaryosu (S4) slotların **tutulmasını** gerektirir. 120 ms
   * gecikmeyle slotlar ana ajan sıraya girmeden boşalıyor ve test zamanlamaya
   * bağlı olarak rastgele düşüyordu — ürün hatası değil, testin kendi yarışı.
   */
  let delayMs = options.delayMs ?? 120

  const sampler = setInterval(() => {
    stats.sampledMax = Math.max(stats.sampledMax, stats.liveCount)
  }, 20)

  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      stats.requests += 1
      stats.inflight += 1
      stats.rawMax = Math.max(stats.rawMax, stats.inflight)

      /**
       * Yaşayan bağlantı sayısı: soketi kapanmış istekler düşülür.
       *
       * İptal edilen bir isteğin TCP kapanışı birkaç ms gecikir; o arada ham
       * sayaç onu "canlı" sayar ve yanlış alarm üretir (ölçülen 4, sınır 2;
       * oysa 20 ms'lik örnekleyici hep 2 gördü). Sağlayıcı da kapalı soketi
       * iş saymaz.
       */
      let settled = false
      let counted = true
      const drop = (reason: 'closed' | 'done'): void => {
        if (!counted) return
        counted = false
        stats.liveCount -= 1
        if (reason === 'closed') stats.aborted += 1
      }

      stats.liveCount += 1
      if (stats.liveCount > stats.maxInflight) {
        stats.maxInflight = stats.liveCount
        // Aşım ham sayaçtan mı geliyor? Kanıt olarak sakla.
        stats.overshootFromClosed = Math.max(
          0,
          stats.inflight - stats.liveCount
        )
      }

      if (options.tagRequests !== false) {
        const tag = /AJAN:([A-Za-z0-9_-]+)/.exec(raw)?.[1]
        stats.arrivals.push(tag ?? `anon-${stats.requests}`)
      }

      // Gerçek dünya olayı: sağlayıcı kotası (429).
      if (stats.inject429 > 0) {
        stats.inject429 -= 1
        stats.inflight -= 1
        drop('done')
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            error: { message: 'Model şu an dolu; eşzamanlı istek sınırı' }
          })
        )
        return
      }

      /**
       * Bağlantı kapanması **canlı** sayacı düşürür.
       *
       * Neden kritik: istemci isteği iptal ettiğinde (AbortController) TCP
       * bağlantısı kapanır ve sağlayıcı o slotu serbest bırakır. Sayacı
       * yalnızca zamanlayıcıda düşürmek, ölü istekleri "canlı" sayar ve
       * ölçüm aracını yalancı yapar — kapatmaya çalıştığımız kusur sınıfı.
       */
      const settle = (aborted: boolean): void => {
        if (settled) return
        settled = true
        stats.inflight -= 1
        drop(aborted ? 'closed' : 'done')
      }
      response.on('close', () => {
        // Yanıt bitmeden kapandıysa iptal; bittiyse zaten settle edildi.
        if (!response.writableEnded) settle(true)
      })

      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(sse({ choices: [{ delta: { content: 'Kısa sonuç: tamam.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        settle(false)
      }, delayMs)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        stats,
        stop: () =>
          new Promise<void>((done) => {
            clearInterval(sampler)
            server.closeAllConnections?.()
            server.close(() => done())
          }),
        reset: () => {
          stats.rawMax = stats.inflight
          stats.maxInflight = stats.liveCount
          stats.sampledMax = stats.liveCount
          stats.requests = 0
          stats.aborted = 0
          stats.overshootFromClosed = 0
          stats.arrivals = []
        },
        setDelay: (ms: number) => {
          delayMs = ms
        },
        /**
         * Taban çizgisi: sunucuda **hiç canlı istek kalmayana** kadar bekle.
         *
         * ## Neden (ilk koşunun bulduğu kusur)
         *
         * Her senaryo başında yalnızca sayaçlar sıfırlanıyordu, ama önceki
         * senaryonun isteği hâlâ canlı olabiliyordu (gecikmeli close, yeniden
         * deneme). Böylece "eşzamanlılık 4" gibi yanlış alarmlar çıktı:
         * 2 eski + 2 yeni. Kaos mühendisliğinin ilk adımı **steady state**
         * tanımlamaktır; ölçüme kirli tabanla başlamak ölçümü geçersiz kılar.
         */
        drain: async (timeoutMs = 10_000) => {
          const deadline = Date.now() + timeoutMs
          while ((stats.liveCount > 0 || stats.inflight > 0) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          stats.inflight = 0
          stats.liveCount = 0
          stats.rawMax = 0
          stats.maxInflight = 0
          stats.sampledMax = 0
          stats.requests = 0
          stats.aborted = 0
          stats.overshootFromClosed = 0
          stats.arrivals = []
        }
      })
    })
  })
}

/** Canlı izleme satırı: sınamayı yürütürken durumu gösterir. */
function watch(label: string, getLine: () => string, intervalMs = 400): () => void {
  const startedAt = Date.now()
  const timer = setInterval(() => {
    console.log(`   · [${label} ${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${getLine()}`)
  }, intervalMs)
  return () => clearInterval(timer)
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'model-stress')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src'), { recursive: true })
  writeFileSync(join(base, 'src', 'a.ts'), 'const a = 1\n', 'utf8')

  const limit = modelGate.maxConcurrent
  console.log(`\n=== Model istek kapısı yük sınaması ===`)
  console.log(`kapı sınırı: ${limit} · eşzamanlılık: bağımsız HTTP sayacıyla ölçülür\n`)

  const { port, stats, stop, reset, drain, setDelay } = await startServer({ delayMs: 120 })

  const runSub = (tag: string, controller = new AbortController()) =>
    runWithWorkspace(base, () =>
      runSubagent({
        parentRequestId: `req-${tag}`,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'stress-model',
        agentType: 'explore',
        prompt: `AJAN:${tag} — src/a.ts dosyasını oku ve tek cümleyle özetle.`,
        workspaceRoot: base,
        mode: 'auto',
        profile: 'build',
        controller,
        send: () => undefined
      })
    ).catch(() => null)

  // ================= S1 · SMOKE =================
  {
    console.log('S1 · smoke (1 ajan)')
    await drain()
    const stopWatch = watch('S1', () => `inflight=${stats.inflight} istek=${stats.requests}`)
    const result = await runSub('smoke')
    stopWatch()
    check('smoke: ajan tamamlandı', result?.ok, true)
    atMost('smoke: eşzamanlılık', stats.maxInflight, limit)
    check('smoke: tek istek', stats.requests, 1)
  }

  // ================= S2 · AVERAGE =================
  {
    console.log('\nS2 · ortalama yük (3 ajan, sınır 2)')
    await drain()
    const stopWatch = watch('S2', () => `inflight=${stats.inflight} yaşayan en fazla=${stats.maxInflight}`)
    const results = await Promise.all([runSub('avg-1'), runSub('avg-2'), runSub('avg-3')])
    stopWatch()
    check('ortalama: üçü de tamamlandı', results.every((r) => r?.ok), true)
    atMost('ortalama: eşzamanlılık', stats.maxInflight, limit)
    atLeast('ortalama: paralellik kullanıldı', stats.maxInflight, limit)
    check('ortalama: üç istek', stats.requests, 3)
  }

  // ================= S3 · STRESS =================
  {
    console.log('\nS3 · stress (10 ajan, sınır 2) — sınırın 5 katı')
    await drain()
    const stopWatch = watch('S3', () =>
      `inflight=${stats.inflight} yaşayan en fazla=${stats.maxInflight} istek=${stats.requests}`
    )
    const controller = new AbortController()
    const startedAt = Date.now()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => runSub(`st-${index}`, controller))
    )
    stopWatch()
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`   · bitti: ${seconds}s · istek=${stats.requests} · yaşayan en fazla=${stats.maxInflight}`)

    check('stress: hiçbir ajan düşmedi', results.filter((r) => r?.ok).length, 10)
    atMost('stress: eşzamanlılık', stats.maxInflight, limit)
    atMost('stress: örnekleyici de sınırı görmedi', stats.sampledMax, limit)
    atLeast('stress: paralellik kullanıldı', stats.maxInflight, limit)
    // Açlık yok: 10 ajanın 10'u da sunucuya ulaştı.
    check('stress: hiçbir ajan açlıktan ölmedi', stats.requests, 10)
    check('stress: kuyruk boş', modelGate.snapshot().queued, 0)
  }

  // ================= S4 · ÖNCELİK (ana ajan) =================
  {
    console.log('\nS4 · öncelik: iki alt ajan slotu tutarken ana ajan bekliyor')
    // Slotların **tutulduğundan** emin olmak için gecikmeyi uzat. 120 ms'de
    // slotlar ana ajan sıraya girmeden boşalıyordu ve test zamanlamaya bağlı
    // olarak rastgele düşüyordu (koşu 3'te tam bu oldu) — ürün hatası değil,
    // testin kendi yarışı.
    setDelay(700)
    await drain()
    // İki alt ajan slotları doldurur.
    const first = runSub('prio-sub-1')
    const second = runSub('prio-sub-2')
    await sleep(60)

    const sink = createRecordingSink()
    const payload: ChatRequest = {
      model: 'stress-model',
      messages: [{ role: 'user', content: 'AJAN:prio-main — kısa cevap ver.' }],
      agent: {
        enabled: true,
        mode: 'auto',
        profile: 'build',
        browser: false,
        computer: false,
        workspace: true
      }
    } as ChatRequest
    const main = runWithWorkspace(base, () =>
      runAgent({
        requestId: 'req-prio-main',
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        payload,
        controller: new AbortController(),
        sink,
        workspaceRoot: base
      })
    ).catch(() => undefined)

    /**
     * Ana ajanın kapıya **gerçekten ulaşmasını** bekle.
     *
     * ## Neden (koşu 3'ün bulgusu)
     *
     * `runAgent` modele gitmeden önce araç kaydı, çalışma alanı, skill
     * kataloğu gibi hazırlıklar yapıyor. Test 20 ms sonra üçüncü alt ajanı
     * başlatınca, ana ajan **henüz kapıda değildi**; alt ajan da haklı olarak
     * öne geçti. Bu ürün hatası değil, testin kendi yarışıydı.
     *
     * Artık öncelik, gözlenebilir bir duruma bağlanıyor:
     * `modelGate.snapshot().mainWaiting === true`.
     */
    const mainAtGate = await waitFor(() => modelGate.snapshot().mainWaiting, 8_000)
    check('öncelik: ana ajan kapıda bekliyor', mainAtGate, true)
    // Ana ajan sıradayken alt ajan başlat: artık öne geçememeli.
    const third = runSub('prio-sub-3')

    const stopWatch = watch('S4', () => `varış sırası: ${stats.arrivals.join(' > ')}`, 250)
    await Promise.all([first, second, third, main])
    stopWatch()

    const order = stats.arrivals
    const mainIndex = order.indexOf('prio-main')
    const sub3Index = order.indexOf('prio-sub-3')
    console.log(`   · varış sırası: ${order.join(' > ')}`)
    check('öncelik: ana ajan sunucuya ulaştı', mainIndex >= 0, true)
    check('öncelik: ana ajan üçüncü alt ajandan önce', mainIndex < sub3Index || sub3Index < 0, true)
    atMost('öncelik: eşzamanlılık', stats.maxInflight, limit)
    // Sonraki senaryolar hızlı sunucuyla koşsun.
    setDelay(120)
  }

  // ================= S5 · KAOS: iptal fırtınası =================
  {
    console.log('\nS5 · kaos: 6 ajan başlat, 3 tanesini ortada iptal et')
    await drain()
    const controllers = Array.from({ length: 6 }, () => new AbortController())
    const runs = controllers.map((controller, index) => runSub(`chaos-${index}`, controller))
    // Slotlar dolduktan sonra iptal et.
    await sleep(80)
    for (const controller of controllers.slice(0, 3)) controller.abort()
    const stopWatch = watch(
      'S5',
      () =>
        `canlı=${stats.inflight} iptal=${stats.aborted} yaşayan en fazla=${stats.maxInflight} ` +
        `kapı=${JSON.stringify(modelGate.snapshot())}`,
      300
    )
    const results = await Promise.all(runs)
    stopWatch()

    console.log(
      `   · yaşayan en fazla=${stats.maxInflight} · örneklenen=${stats.sampledMax} · ` +
        `ham en fazla=${stats.rawMax} (tanılama) · istek=${stats.requests} · ` +
        `iptal=${stats.aborted} · varış=${stats.arrivals.join(',')}`
    )
    // Kanıt: ham sayaç yaşayan sayıdan yüksekse fark **kapanmış soketlerdir**
    // (iptal edilen isteklerin TCP kapanışı gecikir). Sağlayıcı kapalı soketi
    // iş saymaz; bu yüzden ana ölçüt yaşayan (liveCount) sayımdır.
    if (stats.rawMax > stats.maxInflight) {
      console.log(
        `   · not: ham sayaç ${stats.rawMax} > yaşayan ${stats.maxInflight}; ` +
          `fark kapanmış soketlerden (aşım anında ${stats.overshootFromClosed})`
      )
    }
    check('kaos: kalan ajanlar tamamlandı', results.slice(3).every((r) => r?.ok), true)
    atMost('kaos: eşzamanlılık', stats.maxInflight, limit)
    // Kritik: iptal slot sızdırmamalı → kilitlenme yok.
    check('kaos: slot sızıntısı yok', modelGate.snapshot().active, 0)
    check('kaos: kuyruk boş', modelGate.snapshot().queued, 0)

    // Kilitlenme kanıtı: iptalden SONRA yeni iş hâlâ çalışabiliyor.
    await drain()
    const after = await runSub('chaos-after')
    check('kaos: iptalden sonra kapı çalışıyor', after?.ok, true)
  }

  // ================= S6 · SOAK (uzun koşu, sızıntı) =================
  {
    console.log('\nS6 · soak: 5 dalga × 6 ajan = 30 koşu (sızıntı avı)')
    await drain()
    const startedAt = Date.now()
    let completed = 0
    let maxSeen = 0
    for (let wave = 0; wave < 5; wave += 1) {
      const stopWatch = watch('S6', () => `dalga ${wave + 1}/5 · tamam=${completed} · en fazla=${maxSeen}`, 500)
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) => runSub(`soak-${wave}-${index}`))
      )
      stopWatch()
      completed += results.filter((r) => r?.ok).length
      maxSeen = Math.max(maxSeen, stats.maxInflight)
      if (wave === 0) check('soak: ilk dalgada eşzamanlılık korundu', stats.maxInflight <= limit, true)
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`   · bitti: ${seconds}s · tamam=${completed}/30 · en fazla eşzamanlı=${maxSeen}`)

    check('soak: 30/30 tamamlandı', completed, 30)
    atMost('soak: eşzamanlılık hiç aşılmadı', maxSeen, limit)
    check('soak: slot sızıntısı yok', modelGate.snapshot().active, 0)
    check('soak: kuyruk sızıntısı yok', modelGate.snapshot().queued, 0)
    // Sayaç sürüklenmesi: 30 koşudan sonra hâlâ tam kapasite çalışabilmeli.
    await drain()
    const a = runSub('soak-final-a')
    const b = runSub('soak-final-b')
    await sleep(80)
    atLeast('soak: sonrasında hâlâ tam kapasite', modelGate.snapshot().active, Math.min(2, limit))
    await Promise.all([a, b])
  }

  // ================= S7 · ARIZA ENJEKSİYONU (429) =================
  {
    console.log('\nS7 · arıza: sağlayıcı 429 döndürüyor (geçici)')
    await drain()
    stats.inject429 = 2
    const stopWatch = watch('S7', () => `istek=${stats.requests} inflight=${stats.inflight}`, 500)
    const startedAt = Date.now()
    const results = await Promise.all([runSub('fault-1'), runSub('fault-2')])
    stopWatch()
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`   · bitti: ${seconds}s · istek=${stats.requests} (429 sonrası yeniden deneme)`)

    check('arıza: 429 sonrası ajanlar toparlandı', results.every((r) => r?.ok), true)
    atLeast('arıza: yeniden deneme yapıldı', stats.requests, 3)
    check('arıza: kapı sızdırmadı', modelGate.snapshot().active, 0)
  }

  await stop()

  // ================= ÖZET =================
  console.log('\n=== özet ===')
  console.log(`kapı sınırı=${limit} · toplam kontrol=${total} · başarısız=${failed}`)
  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
