import { AiError, RETRY_AFTER_MAX_MS, isRetryable } from './ai/error'

/**
 * Yeniden deneme politikası — OpenCode `packages/core/src/model-retry.ts`
 * dosyasının birebir karşılığı.
 *
 * OpenCode'un zamanlaması (Effect Schedule):
 *   Schedule.min([exponential("2 seconds"), spaced("10 seconds")])
 *   → aralık = min(2^n saniye, 10 saniye)
 *   Schedule.recurs(10) → 10 yeniden deneme
 *   Schedule.jittered   → 0.8–1.2 arası rastgele çarpan
 *
 * Sonuç: 2, 4, 8, 10, 10, 10, 10, 10, 10, 10 saniye; toplam ~84 sn
 * (jitter ile 67–101 sn). Hepsi başarısız olursa hata kullanıcıya döner.
 */

/** İlk bekleme (ms). */
export const BASE_DELAY_MS = 2_000
/** Aralık başına üst sınır (ms). */
export const DELAY_CAP_MS = 10_000
/** En fazla yeniden deneme sayısı. */
export const MAX_RETRIES = 10
/** Jitter aralığı (OpenCode `Schedule.jittered`). */
export const JITTER_MIN = 0.8
export const JITTER_MAX = 1.2

/**
 * Zaman aşımına uğrayan deneme zaten dakikalarca beklemiştir; genel kota
 * ölü bir sağlayıcının isteği saatlerce tutmasına izin verirdi.
 */
export const MAX_TIMEOUT_RETRIES = 3

/** Tek kullanımlık (durumsuz) üretimler için deneme sayısı. */
export const ONE_SHOT_RETRIES = 3

/** Sağlayıcının hiç çalıştırmadığı hatalar (tek kullanımlık üretimlerde). */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * `attempt` (1 tabanlı) için jitter'sız gecikme.
 * OpenCode'taki `min(2^n, 10)` ile aynı: 2, 4, 8, 10, 10…
 */
export function baseDelay(attempt: number): number {
  if (attempt <= 0) return BASE_DELAY_MS
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt - 1)
  return Math.min(exponential, DELAY_CAP_MS)
}

/** Jitter uygulanmış gecikme. `random` testlerde sabitlenebilir. */
export function jitteredDelay(attempt: number, random: () => number = Math.random): number {
  const factor = JITTER_MIN + random() * (JITTER_MAX - JITTER_MIN)
  return Math.max(0, Math.round(baseDelay(attempt) * factor))
}

/**
 * Sağlayıcının istediği gecikme ile politikayı birleştirir:
 * daha uzun olan kazanır, üst sınır 15 dakika.
 */
export function effectiveDelay(
  attempt: number,
  retryAfterMs: number | undefined,
  random: () => number = Math.random
): number {
  const planned = jitteredDelay(attempt, random)
  if (retryAfterMs === undefined) return planned
  return Math.min(Math.max(planned, retryAfterMs), RETRY_AFTER_MAX_MS)
}

export interface RetryDecision {
  retry: true
  attempt: number
  delayMs: number
}

export interface RetryRefusal {
  retry: false
  reason: string
}

export type RetryOutcome = RetryDecision | RetryRefusal

/**
 * Retry politikası — OpenCode `ModelRetry.policy` ile aynı davranış.
 * Durum bilinçlidir: aynı politika örneği deneme sayısını ve zaman aşımı
 * kotasını kendi içinde tutar.
 */
export class RetryPolicy {
  private attempt = 0
  private timeouts = 0
  private readonly maxRetries: number
  private readonly random: () => number

  constructor(options: { maxRetries?: number; random?: () => number } = {}) {
    this.maxRetries = options.maxRetries ?? MAX_RETRIES
    this.random = options.random ?? Math.random
  }

  /**
   * Bir hata için karar verir.
   * `allowRetry` çağıranın önerisidir (OpenCode `input.retry`).
   */
  decide(error: AiError, allowRetry: boolean, shouldRetryHeader?: string | null): RetryOutcome {
    const retryable = isRetryable(error, shouldRetryHeader)
    if (!retryable) {
      return { retry: false, reason: `${error.reason.tag} yeniden denenmez` }
    }

    if (this.attempt >= this.maxRetries) {
      return { retry: false, reason: `deneme sınırı (${this.maxRetries})` }
    }

    if (error.reason.tag === 'Transport' && error.reason.code === 'Timeout') {
      this.timeouts += 1
    }
    if (this.timeouts > MAX_TIMEOUT_RETRIES) {
      return { retry: false, reason: 'zaman aşımı kotası aşıldı' }
    }

    if (!allowRetry) {
      return { retry: false, reason: 'çağıran yeniden denemeyi istemedi' }
    }

    this.attempt += 1
    return {
      retry: true,
      attempt: this.attempt,
      delayMs: effectiveDelay(this.attempt, error.reason.retryAfterMs, this.random)
    }
  }

  /** Toplam deneme sayısı (ilk deneme dahil). */
  get attempts(): number {
    return this.attempt
  }
}

/**
 * Tek kullanımlık üretimler yalnızca sağlayıcının **hiç çalıştırmadığı**
 * hatalarda yeniden denenir (faturalanabilir olabilir).
 * OpenCode `model-retry.ts:80` ile aynı.
 */
export function providerDidNotRun(error: AiError, shouldRetryHeader?: string | null): boolean {
  if (shouldRetryHeader === 'true') return true
  if (shouldRetryHeader === 'false') return false

  switch (error.reason.tag) {
    case 'RateLimit':
      return true
    case 'ProviderInternal':
      return error.reason.status === 503 || error.reason.status === 529
    case 'Transport':
      return (
        error.reason.delivery === 'not-sent' ||
        (error.reason.code !== undefined && NOT_SENT_CODES.has(error.reason.code))
      )
    default:
      return false
  }
}

/** İptal edilebilir bekleme. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Kullanıcıya gösterilecek kısa açıklama. */
export function describeFailure(error: AiError): string {
  switch (error.reason.tag) {
    case 'RateLimit':
      return 'Sunucu istek sınırı'
    case 'ProviderInternal':
      return error.reason.status === 503 ? 'Model şu anda dolu' : 'Sağlayıcı hatası'
    case 'Transport':
      return 'Bağlantı hatası'
    case 'Timeout':
      return 'Sunucu yanıt vermedi'
    case 'Authentication':
      return 'Kimlik doğrulama hatası'
    case 'QuotaExceeded':
      return 'Kota aşıldı'
    case 'ContentPolicy':
      return 'İçerik politikası engeli'
    case 'InvalidRequest':
      return 'Geçersiz istek'
    case 'InvalidProviderOutput':
      return 'Eksik yanıt'
    default:
      return 'Sağlayıcı hatası'
  }
}
