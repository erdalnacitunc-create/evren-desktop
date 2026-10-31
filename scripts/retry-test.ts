/// <reference types="node" />
import {
  DEFAULT_RETRY_POLICY,
  RETRYABLE_STATUS,
  describeStatus,
  isRetryable,
  nextDelay,
  parseRetryAfter,
  retryDelay,
  sleep
} from '../src/main/retry'

/** Yeniden deneme politikası testleri (saf mantık). */
let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

// --- hangi hatalar yeniden denenir ---
for (const status of [408, 425, 429, 500, 502, 503, 504]) {
  check(`${status} yeniden denenir`, isRetryable({ status }), true)
}
for (const status of [400, 401, 403, 404, 422, 451]) {
  check(`${status} denenmez`, isRetryable({ status }), false)
}
check('iptal edilen denenmez', isRetryable({ status: 503, aborted: true }), false)
check('durum kodsuz (ağ) denenir', isRetryable({}), true)
check('yeniden denenebilir küme', [...RETRYABLE_STATUS].sort((a, b) => a - b), [408, 425, 429, 500, 502, 503, 504])

// --- gecikme hesabı ---
check('ilk gecikme', retryDelay(0), 1000)
check('ikinci gecikme', retryDelay(1), 2000)
check('üçüncü gecikme', retryDelay(2), 4000)
check('üst sınır', retryDelay(10), DEFAULT_RETRY_POLICY.maxDelayMs)
check('negatif deneme güvenli', retryDelay(-3), 1000)

// --- Retry-After ---
check('saniye biçimi', parseRetryAfter('3'), 3000)
check('sıfır', parseRetryAfter('0'), 0)
check('aşırı değer kırpılır', parseRetryAfter('9999'), 120_000)
check('boş', parseRetryAfter(''), null)
check('null', parseRetryAfter(null), null)
check('geçersiz', parseRetryAfter('yarın'), null)
{
  const now = Date.parse('2026-01-01T00:00:00Z')
  check('tarih biçimi', parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now), 5000)
  check('geçmiş tarih sıfır', parseRetryAfter('Thu, 01 Jan 2025 00:00:00 GMT', now), 0)
}

// --- sonraki gecikme seçimi ---
check('Retry-After öncelikli', nextDelay(0, 7000), 7000)
check('Retry-After yoksa üstel', nextDelay(1, null), 2000)
check('Retry-After üst sınırı', nextDelay(0, 999_000), DEFAULT_RETRY_POLICY.maxDelayMs)

async function sleepChecks(): Promise<void> {
  // --- sleep iptal edilebilir ---
  const started = Date.now()
  const controller = new AbortController()
  controller.abort()
  await sleep(5000, controller.signal)
  check('iptal edilen bekleme hemen biter', Date.now() - started < 500, true)

  const t0 = Date.now()
  await sleep(60)
  const elapsed = Date.now() - t0
  check('normal bekleme çalışır', elapsed >= 45 && elapsed < 2000, true)

  check('sıfır bekleme anında', await sleep(0).then(() => true), true)
}


// --- açıklamalar ---
check('503 açıklaması', describeStatus(503), 'Model şu anda dolu (503)')
check('429 açıklaması', describeStatus(429), 'Sunucu istek sınırı (429)')
check('502 açıklaması', describeStatus(502), 'Sunucuya ulaşılamadı')
check('bilinmeyen', describeStatus(undefined), 'Bağlantı hatası')

// --- politika varsayılanları ---
check('en fazla deneme', DEFAULT_RETRY_POLICY.maxAttempts, 4)
check('ilk bekleme 1s', DEFAULT_RETRY_POLICY.baseDelayMs, 1000)
check('çarpan 2', DEFAULT_RETRY_POLICY.factor, 2)

void sleepChecks().then(() => {
  console.log(`TOTAL=42 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})
