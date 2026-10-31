/// <reference types="node" />
import { randomBytes } from 'crypto'
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  authorizeToken,
  createFramer,
  createMessage,
  decodeMessage,
  encodeMessage,
  extractToken,
  generateToken,
  tokensMatch
} from '../src/main/transport/protocol'

/**
 * Taşıyıcı protokolü testleri (süreç/soket yok).
 * Çalıştırma: node scripts/run-unit.cjs scripts/transport-protocol-test.ts
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

// --- mesaj oluşturma ---
{
  const message = createMessage('request', 'r1', { method: 'runAgent', payload: { a: 1 } })
  check('sürüm eklenir', message.v, PROTOCOL_VERSION)
  check('tür', message.kind, 'request')
  check('kimlik', message.id, 'r1')
  check('yöntem', message.method, 'runAgent')
  check('yük', message.payload, { a: 1 })
  const minimal = createMessage('ping', 'p1')
  check('yöntemsiz mesaj', Object.keys(minimal).sort(), ['id', 'kind', 'v'])
}

// --- kodlama / çözme turu ---
{
  const messages = [
    createMessage('event', 'e1', { payload: { type: 'content', text: 'satır\nsonu' } }),
    createMessage('response', 'e2', { method: 'get', payload: { ok: true } }),
    createMessage('error', 'e3', { payload: { message: 'hata' } })
  ]
  for (const message of messages) {
    const line = encodeMessage(message)
    check(`tek satır (${message.kind})`, line.endsWith('\n') && line.split('\n').length === 2, true)
    const decoded = decodeMessage(line)
    check(`tur (${message.kind})`, decoded.ok && JSON.stringify(decoded.message) === JSON.stringify(message), true)
  }
  const roundTrip = decodeMessage(encodeMessage(messages[0]))
  check(
    'içerikteki satır sonu korunur',
    roundTrip.ok ? (roundTrip.message.payload as { text: string }).text : '',
    'satır\nsonu'
  )
}

// --- reddedilen çerçeveler ---
{
  const cases: Array<[string, string, string]> = [
    ['boş', '   ', 'empty'],
    ['bozuk JSON', '{ nope', 'bad-json'],
    ['dizi', '[1,2,3]', 'bad-shape'],
    ['sayı', '42', 'bad-shape'],
    ['eski sürüm', JSON.stringify({ v: 0, kind: 'ping', id: 'x' }), 'bad-version'],
    ['sürümsüz', JSON.stringify({ kind: 'ping', id: 'x' }), 'bad-version'],
    ['bilinmeyen tür', JSON.stringify({ v: 1, kind: 'hack', id: 'x' }), 'bad-kind'],
    ['kimliksiz', JSON.stringify({ v: 1, kind: 'ping' }), 'bad-id'],
    ['boş kimlik', JSON.stringify({ v: 1, kind: 'ping', id: '' }), 'bad-id'],
    ['uzun kimlik', JSON.stringify({ v: 1, kind: 'ping', id: 'x'.repeat(201) }), 'bad-id'],
    ['sayısal yöntem', JSON.stringify({ v: 1, kind: 'request', id: 'x', method: 5 }), 'bad-method']
  ]
  for (const [label, line, code] of cases) {
    const result = decodeMessage(line)
    check(`reddedilir: ${label}`, result.ok === false && (result as { error: { code: string } }).error.code, code)
  }
}

// --- boyut sınırı ---
{
  const big = createMessage('event', 'e1', { payload: { text: 'x'.repeat(MAX_FRAME_BYTES + 10) } })
  const result = decodeMessage(encodeMessage(big))
  check('aşırı büyük çerçeve', result.ok === false && (result as { error: { code: string } }).error.code, 'too-large')
}

// --- çerçeveleyici: parçalı geliş ---
{
  const framer = createFramer()
  const a = createMessage('event', 'a', { payload: { n: 1 } })
  const b = createMessage('event', 'b', { payload: { n: 2 } })
  const lineA = encodeMessage(a)
  const lineB = encodeMessage(b)

  // İlk parça: tam satır + ikinci satırın yarısı
  const first = framer.push(lineA + lineB.slice(0, 10))
  check('ilk parçada bir satır', first.length, 1)
  check('ilk satır doğru', decodeMessage(first[0]).ok, true)
  check('yarım satır bekliyor', framer.pending().length > 0, true)

  const second = framer.push(lineB.slice(10))
  check('kalan satır tamamlanır', second.length, 1)
  const decodedB = decodeMessage(second[0])
  check('ikinci satır doğru', decodedB.ok && decodedB.message.id, 'b')
  check('bekleyen kalmadı', framer.pending(), '')
}

// --- çerçeveleyici: boş satırlar atlanır ---
{
  const framer = createFramer()
  const lines = framer.push('\n\n' + encodeMessage(createMessage('ping', 'p')) + '\n\n')
  check('boş satırlar yok sayılır', lines.length, 1)
}

// --- çerçeveleyici: sıfırlama ---
{
  const framer = createFramer()
  framer.push('yarım')
  framer.reset()
  check('sıfırlanır', framer.pending(), '')
}

// --- token karşılaştırma ---
{
  check('aynı token', tokensMatch('abc123', 'abc123'), true)
  check('farklı token', tokensMatch('abc123', 'abc124'), false)
  check('farklı uzunluk', tokensMatch('abc', 'abcd'), false)
  check('boş beklenen', tokensMatch('', 'abc'), false)
  check('boş verilen', tokensMatch('abc', ''), false)
  check('uzun token eşleşir', tokensMatch('a'.repeat(500), 'a'.repeat(500)), true)
}

// --- token üretimi ---
{
  const token = generateToken(randomBytes)
  check('64 karakter hex', token.length, 64)
  check('hex biçimi', /^[0-9a-f]{64}$/.test(token), true)
  check('iki token farklı', generateToken(randomBytes) === generateToken(randomBytes), false)
}

// --- başlık çıkarma ---
{
  check('Bearer', extractToken({ authorization: 'Bearer tok123' }), 'tok123')
  check('Bearer küçük harf', extractToken({ authorization: 'bearer tok123' }), 'tok123')
  check('başlıksız Bearer', extractToken({ authorization: 'tok123' }), 'tok123')
  check('x-evren-token', extractToken({ 'x-evren-token': 'tok456' }), 'tok456')
  check('Bearer öncelikli', extractToken({ authorization: 'Bearer a', 'x-evren-token': 'b' }), 'a')
  check('dizi başlık', extractToken({ authorization: ['Bearer dizi'] }), 'dizi')
  check('boş başlık', extractToken({}), '')
}

// --- kimlik doğrulama ---
{
  const token = 'secret-token-value'
  check('doğru Bearer', authorizeToken(token, { authorization: `Bearer ${token}` }), { ok: true })
  check('doğru özel başlık', authorizeToken(token, { 'x-evren-token': token }), { ok: true })
  check(
    'yanlış token',
    authorizeToken(token, { authorization: 'Bearer yanlis' }),
    { ok: false, error: { message: 'Geçersiz token', code: 'invalid' } }
  )
  check(
    'başlık yok',
    authorizeToken(token, {}),
    { ok: false, error: { message: 'Kimlik doğrulama başlığı yok', code: 'missing' } }
  )
  check(
    'yapılandırma yok (kapalı devre)',
    authorizeToken('', { authorization: 'Bearer herhangi' }),
    { ok: false, error: { message: 'Sunucu tokeni tanımlı değil', code: 'no-token' } }
  )
}

console.log(`TOTAL=49 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
