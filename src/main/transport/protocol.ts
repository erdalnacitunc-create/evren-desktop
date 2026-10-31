import { timingSafeEqual } from 'crypto'

/**
 * Ana süreç ↔ ajan süreci taşıyıcı protokolü.
 *
 * Saf katman: soket, süreç veya Electron bilmez. Bugün ana süreç içinde
 * kullanılıyor; `utilityProcess` hayata geçtiğinde aynı çerçeveleme ve
 * kimlik doğrulama kullanılacak.
 *
 * Tasarım notları:
 * - Her mesaj tek satır JSON'dur (NDJSON). Satır sonu çerçeve sınırıdır;
 *   içerikteki `\n` JSON kaçışıyla taşınır.
 * - Her mesaj `v` (protokol sürümü), `id` (istek kimliği) ve `kind` taşır.
 * - Kimlik doğrulama: paylaşılan token, sabit zamanlı karşılaştırma.
 * - Bilinmeyen sürüm reddedilir; sessizce yorumlanmaz.
 */

export const PROTOCOL_VERSION = 1

/** Taşıyıcıdan geçebilecek mesaj türleri. */
export type TransportKind =
  | 'request'
  | 'response'
  | 'event'
  | 'cancel'
  | 'ping'
  | 'pong'
  | 'error'

export interface TransportMessage {
  /** Protokol sürümü. */
  v: number
  kind: TransportKind
  /** İstek/eşleştirme kimliği. */
  id: string
  /** Yöntem adı (request/response için). */
  method?: string
  /** Yük. JSON ile serileşebilir olmalıdır. */
  payload?: unknown
}

export interface TransportError {
  message: string
  code?: string
}

/** Tek bir satırın (satır sonu olmadan) en büyük uzunluğu. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024

export function createMessage(
  kind: TransportKind,
  id: string,
  extra: { method?: string; payload?: unknown } = {}
): TransportMessage {
  const message: TransportMessage = { v: PROTOCOL_VERSION, kind, id }
  if (extra.method !== undefined) message.method = extra.method
  if (extra.payload !== undefined) message.payload = extra.payload
  return message
}

/** Mesajı NDJSON satırına çevirir (satır sonu dahil). */
export function encodeMessage(message: TransportMessage): string {
  return `${JSON.stringify(message)}\n`
}

export type DecodeResult =
  | { ok: true; message: TransportMessage }
  | { ok: false; error: TransportError }

/** Tek bir satırı çözer. Boş satırlar çağıran tarafından atlanmalıdır. */
export function decodeMessage(line: string): DecodeResult {
  const text = line.trim()
  if (!text) return { ok: false, error: { message: 'Boş çerçeve', code: 'empty' } }
  if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
    return { ok: false, error: { message: 'Çerçeve çok büyük', code: 'too-large' } }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: { message: 'Geçersiz JSON', code: 'bad-json' } }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: { message: 'Mesaj nesne değil', code: 'bad-shape' } }
  }

  const candidate = parsed as Record<string, unknown>
  if (candidate.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: { message: `Desteklenmeyen protokol sürümü: ${String(candidate.v)}`, code: 'bad-version' }
    }
  }
  if (typeof candidate.kind !== 'string' || !isKind(candidate.kind)) {
    return { ok: false, error: { message: 'Geçersiz mesaj türü', code: 'bad-kind' } }
  }
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return { ok: false, error: { message: 'Mesaj kimliği yok', code: 'bad-id' } }
  }
  if (candidate.id.length > 200) {
    return { ok: false, error: { message: 'Mesaj kimliği çok uzun', code: 'bad-id' } }
  }
  if (candidate.method !== undefined && typeof candidate.method !== 'string') {
    return { ok: false, error: { message: 'Yöntem dizesi geçersiz', code: 'bad-method' } }
  }

  return { ok: true, message: candidate as unknown as TransportMessage }
}

function isKind(value: string): value is TransportKind {
  return (
    value === 'request' ||
    value === 'response' ||
    value === 'event' ||
    value === 'cancel' ||
    value === 'ping' ||
    value === 'pong' ||
    value === 'error'
  )
}

/**
 * Gelen baytlardan tam satırları ayıklar; kalan yarım satırı saklar.
 * Soket parçalanmasına karşı biriktirici görevi görür.
 */
export function createFramer(): {
  push(chunk: string): string[]
  pending(): string
  reset(): void
} {
  let buffer = ''
  return {
    push(chunk: string): string[] {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      return lines.filter((line) => line.trim().length > 0)
    },
    pending(): string {
      return buffer
    },
    reset(): void {
      buffer = ''
    }
  }
}

/** Sabit zamanlı token karşılaştırması. */
export function tokensMatch(expected: string, provided: string): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  // timingSafeEqual eşit uzunluk ister; uzunluk farkı zaten başarısızdır.
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * İstek başlığından token çıkarır.
 * `Bearer <token>` veya `x-evren-token: <token>` kabul edilir.
 */
export function extractToken(headers: Record<string, string | string[] | undefined>): string {
  const authorization = headers['authorization']
  const rawAuth = Array.isArray(authorization) ? authorization[0] : authorization
  if (typeof rawAuth === 'string') {
    const bearer = rawAuth.replace(/^Bearer\s+/i, '').trim()
    if (bearer) return bearer
  }
  const custom = headers['x-evren-token']
  const rawCustom = Array.isArray(custom) ? custom[0] : custom
  return typeof rawCustom === 'string' ? rawCustom.trim() : ''
}

export type AuthVerdict = { ok: true } | { ok: false; error: TransportError }

/**
 * Bir isteğin kimliğini doğrular.
 * Token yoksa veya eşleşmiyorsa reddedilir; `expected` boşsa yapılandırma
 * hatası olarak reddedilir (kapalı devre).
 */
export function authorizeToken(
  expected: string,
  headers: Record<string, string | string[] | undefined>
): AuthVerdict {
  if (!expected) {
    return { ok: false, error: { message: 'Sunucu tokeni tanımlı değil', code: 'no-token' } }
  }
  const provided = extractToken(headers)
  if (!provided) {
    return { ok: false, error: { message: 'Kimlik doğrulama başlığı yok', code: 'missing' } }
  }
  if (!tokensMatch(expected, provided)) {
    return { ok: false, error: { message: 'Geçersiz token', code: 'invalid' } }
  }
  return { ok: true }
}

/** Rastgele taşıyıcı tokeni üretir (32 bayt, hex). */
export function generateToken(randomBytes: (size: number) => Buffer): string {
  return randomBytes(32).toString('hex')
}
