/**
 * Sağlayıcı istek kapısı (0.4.25).
 *
 * ## Neden
 *
 * 0.4.24 canlı koşusunda (22 Kasım, 16:09) tur **tamamen düştü**:
 *
 * | | |
 * |---|---|
 * | Sağlayıcı sınırı | "hesabınız bu modelde en fazla **2 eşzamanlı istek** açabilir" |
 * | Bizim gönderdiğimiz | ana ajan 1 + `explore` 2 = **3** |
 * | Sonuç | 16 yeniden deneme, sonra `assistant.failed` — 10 dk 42 sn boşa gitti |
 *
 * Kök neden bir muhasebe hatası: `subagentConcurrency = 2` yalnızca **alt
 * ajanları** sayıyordu. Ana ajanın kendi isteği hesaba katılmıyordu. Yani
 * sınır "alt ajan sayısı" değil, **uçuştaki model isteği** sayısıdır.
 *
 * ## Davranış
 *
 * - Süreç genelinde tek sayaç: ana ajan, alt ajanlar, sentez ve hakem aynı
 *   kapıyı paylaşır.
 * - Varsayılan 2 (`EVREN_MODEL_CONCURRENCY` ile değişir).
 * - **Ana ajan önceliği**: ana ajan sırada beklerken yeni alt ajan isteği
 *   başlamaz. Aksi hâlde iki alt ajan iki slotu tutar ve ana ajan — kullanıcının
 *   gördüğü tek şey — aç kalır.
 * - Slot yalnızca **istek süresince** tutulur; araç çalışırken bırakılır. Bu
 *   yüzden kilitlenme (deadlock) oluşmaz: `task_wait` bekleyen ana ajan slot
 *   tutmaz.
 *
 * Modül saftır (IO yok); `scripts/model-gate-test.ts` ile doğrulanır.
 */

export type ModelPriority = 'main' | 'sub'

export interface ModelGateSnapshot {
  active: number
  queued: number
  maxConcurrent: number
  /** Ana ajan sırası bekliyor mu (yeni alt ajan isteği başlatılmaz). */
  mainWaiting: boolean
}

interface Waiter {
  priority: ModelPriority
  seq: number
  resolve: () => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

const PRIORITY_RANK: Record<ModelPriority, number> = { main: 0, sub: 1 }

/** Varsayılan eşzamanlı model isteği. Sağlayıcı 2 diyor; 2'de kalıyoruz. */
export const DEFAULT_MODEL_CONCURRENCY = 2

export function modelConcurrencyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env['EVREN_MODEL_CONCURRENCY'])
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_MODEL_CONCURRENCY
  return Math.max(1, Math.min(8, Math.round(raw)))
}

export class ModelGate {
  readonly maxConcurrent: number
  private active = 0
  private seq = 0
  private waiters: Waiter[] = []

  constructor(maxConcurrent: number = DEFAULT_MODEL_CONCURRENCY) {
    this.maxConcurrent = Math.max(1, Math.round(maxConcurrent))
  }

  /**
   * Slot ister. Dönen fonksiyon slotu bırakır (birden çok kez çağrılabilir;
   * ikinci çağrı yok sayılır — `finally` + `catch` çift bırakmayı önler).
   */
  acquire(priority: ModelPriority, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new Error('İstek iptal edildi.'))
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        seq: this.seq++,
        resolve: () => {
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active = Math.max(0, this.active - 1)
            this.drain()
          })
        },
        reject,
        signal
      }
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new Error('İstek iptal edildi.'))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
      this.drain()
    })
  }

  snapshot(): ModelGateSnapshot {
    return {
      active: this.active,
      queued: this.waiters.length,
      maxConcurrent: this.maxConcurrent,
      mainWaiting: this.waiters.some((waiter) => waiter.priority === 'main')
    }
  }

  private drain(): void {
    while (this.waiters.length > 0 && this.active < this.maxConcurrent) {
      const next = this.pickNext()
      if (!next) return
      this.waiters.splice(this.waiters.indexOf(next), 1)
      if (next.onAbort && next.signal) {
        next.signal.removeEventListener('abort', next.onAbort)
      }
      this.active += 1
      next.resolve()
    }
  }

  /**
   * Sıradaki istek: önce öncelik, sonra geliş sırası.
   *
   * Ana ajan beklerken **alt ajan başlatılmaz** — alt ajanlar zaten ana ajanın
   * ürünü; onları öne almak kullanıcıyı bekletmekten başka işe yaramaz.
   */
  private pickNext(): Waiter | undefined {
    if (this.waiters.length === 0) return undefined
    const mainWaiting = this.waiters.some((waiter) => waiter.priority === 'main')
    const candidates = mainWaiting
      ? this.waiters.filter((waiter) => waiter.priority === 'main')
      : this.waiters
    return candidates.reduce((best, waiter) =>
      PRIORITY_RANK[waiter.priority] < PRIORITY_RANK[best.priority] ||
      (PRIORITY_RANK[waiter.priority] === PRIORITY_RANK[best.priority] && waiter.seq < best.seq)
        ? waiter
        : best
    )
  }
}

/** Süreç genelindeki tek kapı. */
export const modelGate = new ModelGate(modelConcurrencyFromEnv())

/**
 * İptal edilen isteğin slotunu hemen geri verme (0.4.25).
 *
 * ## Neden
 *
 * Yük sınamasında ölçüldü: 3 istek aynı anda iptal edilince, istemci tarafında
 * `fetch` **anında** reddediliyor ve slot serbest kalıyor; ama sağlayıcı
 * tarafında soketin kapanması birkaç milisaniye gecikiyor. O aralıkta kapı yeni
 * istek açıyor ve sağlayıcı **kısa süreliğine sınırın üstünde** istek görüyor
 * (ölçülen: 4 canlı, sınır 2 — süre <20 ms).
 *
 * Gerçek sağlayıcılar da iptal edilen isteği hemen düşürmez: istek ya
 * tamamlanır ya da sunucu kapanışı fark eder. Bu yüzden slotu **grace**
 * süresi kadar tutmak, kapıyı sağlayıcının gerçek davranışına hizalar.
 *
 * ## Maliyet
 *
 * İptal sonrası en fazla `EVREN_ABORT_GRACE_MS` (varsayılan 250 ms) kapasite
 * eksik kalır. İptal nadir olduğu için pratikte görünmez; karşılığında 429
 * fırtınası riski kalkar.
 */
export function abortGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['EVREN_ABORT_GRACE_MS'])
  if (!Number.isFinite(raw) || raw < 0) return 250
  return Math.min(5_000, Math.round(raw))
}

/**
 * Bir model isteğini kapıdan geçirir.
 *
 * Kullanım: yalnızca **istek** sarmalanır, araç yürütmesi sarmalanmaz.
 */
export async function withModelSlot<T>(
  priority: ModelPriority,
  run: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const release = await modelGate.acquire(priority, signal)
  let aborted = false
  try {
    return await run()
  } catch (error) {
    if (signal?.aborted) aborted = true
    throw error
  } finally {
    if (aborted) {
      // Sağlayıcı tarafında soket hâlâ kapanıyor olabilir; slotu hemen
      // yeniden kullanma (yukarıdaki gerekçe).
      const delay = abortGraceMs()
      if (delay > 0) setTimeout(release, delay).unref?.()
      else release()
    } else {
      release()
    }
  }
}
