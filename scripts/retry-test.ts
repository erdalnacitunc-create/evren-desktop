/// <reference types="node" />
import {
  AiError,
  RETRY_AFTER_MAX_MS,
  classifyFailure,
  isInterruptedStream,
  isRetryable,
  parseRetryAfter,
  type AiErrorReasonTag
} from '../src/main/ai/error'
import {
  BASE_DELAY_MS,
  DELAY_CAP_MS,
  JITTER_MAX,
  JITTER_MIN,
  MAX_RETRIES,
  MAX_TIMEOUT_RETRIES,
  RetryPolicy,
  baseDelay,
  describeFailure,
  effectiveDelay,
  jitteredDelay,
  providerDidNotRun,
  sleep
} from '../src/main/retry'

/**
 * OpenCode parity testleri: hata sınıflandırma + retry politikası.
 * Çalıştırma: node scripts/run-unit.cjs scripts/retry-test.ts
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const tagOf = (status: number | undefined, body?: string, message?: string): AiErrorReasonTag =>
  classifyFailure({ status, body, message: message ?? body }).reason.tag

// ============ 1) SINIFLANDIRMA (OpenCode provider-error.ts) ============
check('429 → RateLimit', tagOf(429), 'RateLimit')
check('503 → ProviderInternal', tagOf(503), 'ProviderInternal')
check('529 → ProviderInternal', tagOf(529), 'ProviderInternal')
check('502 → ProviderInternal', tagOf(502), 'ProviderInternal')
check('401 → Authentication', tagOf(401), 'Authentication')
check('403 → Authentication', tagOf(403), 'Authentication')
check('402 → QuotaExceeded', tagOf(402), 'QuotaExceeded')
check('400 → InvalidRequest', tagOf(400), 'InvalidRequest')
check('404 → InvalidRequest', tagOf(404), 'InvalidRequest')
check('422 → InvalidRequest', tagOf(422), 'InvalidRequest')
check(
  'insufficient_quota → QuotaExceeded',
  tagOf(429, '{"error":{"code":"insufficient_quota"}}'),
  'QuotaExceeded'
)
check(
  'overloaded_error → ProviderInternal',
  tagOf(500, '{"error":{"type":"overloaded_error"}}'),
  'ProviderInternal'
)
check('içerik politikası → ContentPolicy', tagOf(400, 'blocked by content policy'), 'ContentPolicy')
check('ECONNREFUSED → Transport', classifyFailure({ code: 'ECONNREFUSED', message: 'x' }).reason.tag, 'Transport')
check(
  'ECONNREFUSED not-sent',
  classifyFailure({ code: 'ECONNREFUSED', message: 'x' }).reason.delivery,
  'not-sent'
)
check(
  'ECONNRESET accepted',
  classifyFailure({ code: 'ECONNRESET', message: 'x' }).reason.delivery,
  'accepted'
)

// ============ 2) isRetryable tablosu ============
const err = (tag: AiErrorReasonTag, extra: Partial<AiError['reason']> = {}): AiError =>
  new AiError({ tag, message: tag, ...extra })

check('RateLimit denenir', isRetryable(err('RateLimit')), true)
check('ProviderInternal denenir', isRetryable(err('ProviderInternal')), true)
check('Authentication denenmez', isRetryable(err('Authentication')), false)
check('QuotaExceeded denenmez', isRetryable(err('QuotaExceeded')), false)
check('ContentPolicy denenmez', isRetryable(err('ContentPolicy')), false)
check('InvalidRequest denenmez', isRetryable(err('InvalidRequest')), false)
check('Timeout denenmez', isRetryable(err('Timeout')), false)
check('UnknownProvider denenir', isRetryable(err('UnknownProvider')), true)
check(
  'Transport read → denenir',
  isRetryable(err('Transport', { operation: 'read', delivery: 'accepted' })),
  true
)
check(
  'Transport rejected → denenmez',
  isRetryable(err('Transport', { operation: 'request', delivery: 'rejected' })),
  false
)
check(
  'InvalidProviderOutput incomplete → denenir',
  isRetryable(err('InvalidProviderOutput', { classification: 'incomplete-stream' })),
  true
)
check(
  'InvalidProviderOutput other → denenmez',
  isRetryable(err('InvalidProviderOutput', { classification: 'other' })),
  false
)
check('x-should-retry=true ezer', isRetryable(err('Authentication'), 'true'), true)
check('x-should-retry=false ezer', isRetryable(err('RateLimit'), 'false'), false)

// ============ 3) isInterruptedStream ============
check(
  'okuma hatası kesinti sayılır',
  isInterruptedStream(err('Transport', { operation: 'read' })),
  true
)
check(
  'istek hatası kesinti sayılmaz',
  isInterruptedStream(err('Transport', { operation: 'request' })),
  false
)
check(
  'eksik akış kesinti sayılır',
  isInterruptedStream(err('InvalidProviderOutput', { classification: 'incomplete-stream' })),
  true
)

// ============ 4) GECİKME ZAMANLAMASI (OpenCode Schedule) ============
check('1. deneme 2s', baseDelay(1), 2_000)
check('2. deneme 4s', baseDelay(2), 4_000)
check('3. deneme 8s', baseDelay(3), 8_000)
check('4. deneme 10s (tavan)', baseDelay(4), 10_000)
check('10. deneme 10s', baseDelay(10), DELAY_CAP_MS)
check('taban sabiti', BASE_DELAY_MS, 2_000)
check('tavan sabiti', DELAY_CAP_MS, 10_000)
check('azami deneme', MAX_RETRIES, 10)
check('zaman aşımı kotası', MAX_TIMEOUT_RETRIES, 3)

// Toplam bekleme ~84s (OpenCode yorumu)
let total = 0
for (let index = 1; index <= MAX_RETRIES; index++) total += baseDelay(index)
check('toplam bekleme 84s', total, 84_000)

// Jitter aralığı
const low = jitteredDelay(1, () => 0)
const high = jitteredDelay(1, () => 1)
check('jitter alt sınır', low, Math.round(2_000 * JITTER_MIN))
check('jitter üst sınır', high, Math.round(2_000 * JITTER_MAX))

// retry-after daha uzunsa o kazanır, 15 dk ile sınırlı
check('retry-after uzunsa kazanır', effectiveDelay(1, 30_000, () => 0.5), 30_000)
check('retry-after 15 dk ile sınırlı', effectiveDelay(1, 9_999_999, () => 0.5), RETRY_AFTER_MAX_MS)
check('retry-after kısa ise plan kazanır', effectiveDelay(3, 1_000, () => 0.5), 8_000)

// ============ 5) Retry-After ayrıştırma ============
check('saniye', parseRetryAfter('3'), 3_000)
check('aşırı değer 15 dk', parseRetryAfter('99999'), RETRY_AFTER_MAX_MS)
check('boş', parseRetryAfter(''), undefined)
check('null', parseRetryAfter(null), undefined)
check('geçersiz', parseRetryAfter('yarın'), undefined)
{
  const now = Date.parse('2026-01-01T00:00:00Z')
  check('tarih', parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now), 5_000)
}

// ============ 6) Politika durumu ============
{
  const policy = new RetryPolicy({ random: () => 0.5 })
  const transient = err('RateLimit')
  const first = policy.decide(transient, true)
  check('ilk karar denenir', first.retry, true)
  check('ilk deneme 1', first.retry && first.attempt, 1)
  check('ilk gecikme 2s', first.retry && first.delayMs, 2_000)

  let last = first
  for (let index = 0; index < 20 && last.retry; index++) {
    last = policy.decide(transient, true)
  }
  check('sınırda durur', last.retry, false)
  check('toplam deneme 10', policy.attempts, MAX_RETRIES)
}

{
  const policy = new RetryPolicy({ random: () => 0.5 })
  const permanent = err('Authentication')
  check('kalıcı hata denenmez', policy.decide(permanent, true).retry, false)
  check('kalıcı hatada sayaç artmaz', policy.attempts, 0)
}

{
  const policy = new RetryPolicy({ random: () => 0.5 })
  const timeout = err('Transport', { operation: 'read', code: 'Timeout' })
  let decisions = 0
  for (let index = 0; index < 20; index++) {
    if (policy.decide(timeout, true).retry) decisions += 1
    else break
  }
  check('zaman aşımı kotası 3', decisions, MAX_TIMEOUT_RETRIES)
}

{
  const policy = new RetryPolicy({ random: () => 0.5 })
  check(
    'çağıran reddederse durur',
    policy.decide(err('RateLimit'), false).retry,
    false
  )
}

// ============ 7) Tek kullanımlık üretim ============
check('RateLimit çalışmadı', providerDidNotRun(err('RateLimit')), true)
check('503 çalışmadı', providerDidNotRun(err('ProviderInternal', { status: 503 })), true)
check('500 çalıştı', providerDidNotRun(err('ProviderInternal', { status: 500 })), false)
check(
  'not-sent çalışmadı',
  providerDidNotRun(err('Transport', { delivery: 'not-sent' })),
  true
)
check(
  'accepted çalıştı',
  providerDidNotRun(err('Transport', { delivery: 'accepted' })),
  false
)
check('başlık true ezer', providerDidNotRun(err('Authentication'), 'true'), true)

// ============ 8) Açıklamalar ============
check('503 açıklaması', describeFailure(err('ProviderInternal', { status: 503 })), 'Model şu anda dolu')
check('RateLimit açıklaması', describeFailure(err('RateLimit')), 'Sunucu istek sınırı')
check('Timeout açıklaması', describeFailure(err('Timeout')), 'Sunucu yanıt vermedi')

// ============ 9) sleep iptal edilebilir ============
async function sleepChecks(): Promise<void> {
  const controller = new AbortController()
  controller.abort()
  const started = Date.now()
  await sleep(5000, controller.signal)
  check('iptal edilen bekleme hemen biter', Date.now() - started < 400, true)

  const t0 = Date.now()
  await sleep(60)
  const elapsed = Date.now() - t0
  check('normal bekleme çalışır', elapsed >= 40 && elapsed < 2000, true)

  check('sıfır bekleme anında', await sleep(0).then(() => true), true)
}

void sleepChecks().then(() => {
  console.log(`TOTAL=66 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})
