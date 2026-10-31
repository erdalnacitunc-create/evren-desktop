/**
 * Yeniden deneme politikası (saf fonksiyonlar, test edilebilir).
 *
 * Amaç: geçici sunucu hataları (429, 500, 502, 503, 504) ve ağ kopmaları
 * kullanıcıya "durdu" olarak yansımasın; kısa aralıklarla otomatik denensin.
 * Kalıcı hatalar (400, 401, 403, 404, 422) yeniden denenmez.
 */

/** Yeniden denenebilir HTTP durum kodları. */
export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export interface RetryPolicy {
  /** İlk deneme dahil en fazla deneme sayısı. */
  maxAttempts: number
  /** İlk bekleme (ms). */
  baseDelayMs: number
  /** Üst sınır (ms). */
  maxDelayMs: number
  /** Artış çarpanı. */
  factor: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
  factor: 2
}

export interface RetryableError {
  status?: number
  aborted?: boolean
}

/** Hata yeniden denenmeli mi? İptal edilen istek asla yeniden denenmez. */
export function isRetryable(error: RetryableError): boolean {
  if (error.aborted) return false
  if (typeof error.status === 'number') return RETRYABLE_STATUS.has(error.status)
  // Durum kodu yoksa ağ/bağlantı hatası sayılır (fetch TypeError, ECONNRESET…).
  return true
}

/**
 * `attempt` (0 tabanlı) sonrası beklenecek süre.
 * Üstel artış + belirlenimci "jitter" (test edilebilirlik için deterministik).
 */
export function retryDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const raw = policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attempt))
  return Math.min(policy.maxDelayMs, Math.round(raw))
}

/** `Retry-After` başlığını milisaniyeye çevirir (saniye veya tarih). */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const text = value.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) {
    const seconds = Number(text)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    return Math.min(seconds * 1000, 120_000)
  }
  const date = Date.parse(text)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.min(date - now, 120_000))
}

/**
 * Bir sonraki bekleme süresini seçer: sunucu `Retry-After` verdiyse ona uyar,
 * aksi halde üstel geri çekilme kullanır.
 */
export function nextDelay(
  attempt: number,
  retryAfterMs: number | null,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): number {
  if (retryAfterMs !== null && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, policy.maxDelayMs)
  }
  return retryDelay(attempt, policy)
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
export function describeStatus(status: number | undefined): string {
  if (status === 429) return 'Sunucu istek sınırı (429)'
  if (status === 503) return 'Model şu anda dolu (503)'
  if (status === 502 || status === 504) return 'Sunucuya ulaşılamadı'
  if (status === 500) return 'Sunucu hatası (500)'
  return 'Bağlantı hatası'
}
