import { createLogger } from '../logger'

/**
 * AI sağlayıcı hata modeli — OpenCode'un `packages/ai/src/schema/errors.ts` ve
 * `packages/ai/src/provider-error.ts` yapısının birebir karşılığı.
 *
 * Amaç: "5xx ise yeniden dene" gibi kaba bir kural yerine, hatanın **ne
 * olduğunu** sınıflandırmak. OpenCode'da retry kararı bu sınıflandırmaya
 * dayanır:
 *
 *   RateLimit, ProviderInternal                 → yeniden denenir
 *   Transport (not-sent, veya read sırasında)   → yeniden denenir
 *   InvalidProviderOutput (incomplete-stream)   → yeniden denenir
 *   UnknownProvider                             → yeniden denenir
 *   Authentication, QuotaExceeded, ContentPolicy,
 *   InvalidRequest, UnsupportedOperation, Timeout → denenmez
 *
 * `x-should-retry` başlığı her şeyi ezer (true → dene, false → deneme).
 */

const log = createLogger('ai/error')

export type AiErrorReasonTag =
  | 'RateLimit'
  | 'ProviderInternal'
  | 'Transport'
  | 'InvalidProviderOutput'
  | 'UnknownProvider'
  | 'Authentication'
  | 'QuotaExceeded'
  | 'ContentPolicy'
  | 'InvalidRequest'
  | 'UnsupportedOperation'
  | 'Timeout'

/** Taşıma hatasının hangi aşamada oluştuğu. */
export type TransportOperation = 'request' | 'read'

/**
 * İsteğin sağlayıcıya ulaşıp ulaşmadığı.
 * OpenCode bunu "model çalıştı mı" sorusunu yanıtlamak için kullanır:
 * `rejected` = sunucu istediği reddetti, model hiç çalışmadı.
 */
export type TransportDelivery = 'not-sent' | 'accepted' | 'rejected'

export interface AiErrorReason {
  tag: AiErrorReasonTag
  message: string
  status?: number
  /** Sağlayıcının istediği bekleme (ms). Yalnızca RateLimit/ProviderInternal. */
  retryAfterMs?: number
  /** Transport için. */
  operation?: TransportOperation
  delivery?: TransportDelivery
  code?: string
  /** InvalidProviderOutput için. */
  classification?: 'incomplete-stream' | 'other'
}

export class AiError extends Error {
  readonly reason: AiErrorReason
  /**
   * Bu hatadan önce görünür çıktı (metin veya düşünme) üretildi mi?
   * OpenCode `record.outputStarted` ile aynı anlamdadır: true ise şeffaf
   * yeniden deneme yapılmaz, yanıt **devam ettirilir**.
   */
  outputStarted = false
  /** O ana kadar biriken içerik (devam ettirme için). */
  partialContent = ''
  partialReasoning = ''

  constructor(reason: AiErrorReason) {
    super(reason.message)
    this.name = 'AiError'
    this.reason = reason
  }

  get status(): number | undefined {
    return this.reason.status
  }

  get retryAfterMs(): number | undefined {
    return this.reason.retryAfterMs
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError
}

/** OpenCode `provider-error.ts:88` ile aynı karar tablosu. */
export function isRetryable(error: AiError, override?: string | null): boolean {
  const header = override ?? undefined
  if (header === 'true') return true
  if (header === 'false') return false

  switch (error.reason.tag) {
    case 'RateLimit':
    case 'ProviderInternal':
      return true
    // WebSocket onayı, model çıktısı oluşmadan önce teslimi "kabul edildi"
    // işaretler. Okuma hataları yine de kurtarılabilir.
    case 'Transport':
      return (
        error.reason.delivery !== 'rejected' &&
        (error.reason.delivery !== 'accepted' || error.reason.operation === 'read')
      )
    case 'InvalidProviderOutput':
      return error.reason.classification === 'incomplete-stream'
    // Tanınmayan hatalar yeniden denenir: geçici arızalar tam olarak
    // sınıflandırıcının öngörmediği biçimlerde gelir.
    case 'UnknownProvider':
      return true
    case 'Authentication':
    case 'QuotaExceeded':
    case 'ContentPolicy':
    case 'InvalidRequest':
    case 'UnsupportedOperation':
    case 'Timeout':
      return false
    default:
      return false
  }
}

/** Akış kesintisi mi? (kısmi çıktı sonrası "devam ettir" kararı için.) */
export function isInterruptedStream(error: AiError): boolean {
  if (error.reason.tag === 'InvalidProviderOutput') {
    return error.reason.classification === 'incomplete-stream'
  }
  if (error.reason.tag === 'Transport') return error.reason.operation === 'read'
  return false
}

/** Kota/aşıri yük ayrımı için sağlayıcı metinlerini tanıyan kalıplar. */
const RATE_LIMIT_TEXT = /rate[\s_-]?limit|too[\s_-]?many[\s_-]?requests|throttl/i
const OVERLOAD_TEXT = /overloaded|service[\s_-]?unavailable|server[\s_-]?is[\s_-]?overloaded/i
const QUOTA_TEXT =
  /insufficient[\s_-]?(?:quota|balance)|quota[\s_-]?exceeded|budget[\s_-]?exceeded|usage[\s_-]?limit|credit[\s_-]?limit/i
const POLICY_TEXT =
  /content[\s_-]?policy|moderation|safety[\s_-]?system|blocked[\s_-]?by[\s_-]?content|responsibleai/i
const AUTH_TEXT = /incorrect[\s_-]?api[\s_-]?key|invalid[\s_-]?api[\s_-]?key|unauthorized/i

export interface ClassifyInput {
  status?: number
  message?: string
  code?: string
  operation?: TransportOperation
  delivery?: TransportDelivery
  retryAfterMs?: number
  shouldRetryHeader?: string | null
  /** Sağlayıcı yanıt gövdesindeki ham hata metni. */
  body?: string
}

/**
 * HTTP durum kodu + gövde metninden OpenCode sınıflandırmasını üretir.
 * OpenCode'un binary'sindeki tabloyla aynı öncelik sırası izlenir:
 * önce ağ/taşıma, sonra durum kodu, sonra gövde metni.
 */
export function classifyFailure(input: ClassifyInput): AiError {
  const message = (input.message ?? '').slice(0, 600) || 'Sağlayıcı hatası'
  const probe = `${input.message ?? ''} ${input.body ?? ''}`

  // Ağ/taşıma hataları: durum kodu yok, kod var (ECONNRESET, ENOTFOUND…)
  if (input.status === undefined && input.code) {
    return new AiError({
      tag: 'Transport',
      message,
      code: input.code,
      operation: input.operation ?? 'request',
      delivery:
        input.delivery ??
        (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(input.code)
          ? 'not-sent'
          : 'accepted')
    })
  }

  // Zaman aşımı: yeniden denenmez (deneme zaten dakikalarca beklemiştir).
  if (input.status === undefined && /timeout|zaman aşımı/i.test(probe)) {
    return new AiError({
      tag: 'Timeout',
      message,
      operation: input.operation ?? 'read'
    })
  }

  const status = input.status
  // Kota kontrolü 429'dan ÖNCE gelir: OpenCode "hesap kotaları 429/402 olarak
  // gelir ama bunlar throttle değildir" der (provider-error.ts:126).
  if (status === 402 || QUOTA_TEXT.test(probe)) {
    return new AiError({ tag: 'QuotaExceeded', message, status })
  }
  if (status === 429 || (status === undefined && RATE_LIMIT_TEXT.test(probe))) {
    return new AiError({
      tag: 'RateLimit',
      message,
      status,
      retryAfterMs: input.retryAfterMs
    })
  }
  if (status === 401 || status === 403 || (status === undefined && AUTH_TEXT.test(probe))) {
    return new AiError({ tag: 'Authentication', message, status })
  }
  if (status === 503 || status === 529 || OVERLOAD_TEXT.test(probe)) {
    return new AiError({
      tag: 'ProviderInternal',
      message,
      status,
      // 503 "aşırı yük" OpenCode'da yeniden denenebilir; retry-after taşır.
      retryAfterMs: input.retryAfterMs
    })
  }
  if (POLICY_TEXT.test(probe)) {
    return new AiError({ tag: 'ContentPolicy', message, status })
  }
  if (status !== undefined && status >= 500) {
    return new AiError({ tag: 'ProviderInternal', message, status, retryAfterMs: input.retryAfterMs })
  }
  if (status !== undefined && status >= 400) {
    return new AiError({ tag: 'InvalidRequest', message, status })
  }

  // Anlaşılamayan biçim: OpenCode bilinçli olarak "yeniden dene" der.
  return new AiError({ tag: 'UnknownProvider', message, status })
}

/** `Retry-After` başlığını ms'ye çevirir. OpenCode sınırı 15 dakikadır. */
export const RETRY_AFTER_MAX_MS = 15 * 60 * 1000

export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now()
): number | undefined {
  if (!value) return undefined
  const text = value.trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) {
    const seconds = Number(text)
    if (!Number.isFinite(seconds) || seconds < 0) return undefined
    return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS)
  }
  const date = Date.parse(text)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.min(date - now, RETRY_AFTER_MAX_MS))
}

/** Sağlayıcı yanıtındaki hatayı loglanabilir hale getirir. */
export function logAiError(error: AiError, context: string): void {
  log.warn(
    `${context}: ${error.reason.tag}${error.reason.status ? ` (HTTP ${error.reason.status})` : ''} — ${error.message.slice(0, 200)}`
  )
}
