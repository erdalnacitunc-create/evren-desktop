/// <reference types="node" />
import { app } from 'electron'
import { isAuthorized } from '../src/main/headless'
import { ensureHeadlessToken } from '../src/main/credentials'

/**
 * Headless API kimlik doğrulama testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/headless-auth-test.ts
 *
 * `isAuthorized` üretim kodundan geliyor (kopya değil); sabit zamanlı
 * karşılaştırmaya geçişte davranışın korunduğunu doğrular.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

app.whenReady().then(async () => {
  const token = await ensureHeadlessToken()
  check('token üretildi', typeof token === 'string' && token.length > 20, true)

  check('Bearer ile yetkili', isAuthorized(token, { authorization: `Bearer ${token}` }), true)
  check('küçük harf bearer', isAuthorized(token, { authorization: `bearer ${token}` }), true)
  check('özel başlık', isAuthorized(token, { 'x-evren-token': token }), true)
  check('dizi başlık', isAuthorized(token, { authorization: [`Bearer ${token}`] }), true)
  check('yanlış token', isAuthorized(token, { authorization: 'Bearer yanlis' }), false)
  check('başlık yok', isAuthorized(token, {}), false)
  check('boş başlık', isAuthorized(token, { authorization: '' }), false)
  check(
    'bir karakter eksik reddedilir',
    isAuthorized(token, { authorization: `Bearer ${token.slice(0, -1)}` }),
    false
  )
  check(
    'fazla karakter reddedilir',
    isAuthorized(token, { authorization: `Bearer ${token}extra` }),
    false
  )
  check('token tanımsızsa kapalı', isAuthorized(null, { authorization: 'Bearer herhangi' }), false)
  check('boş token kapalı', isAuthorized('', { authorization: 'Bearer herhangi' }), false)
  check(
    'Bearer önceliği: boş Bearer özel başlığa düşer',
    isAuthorized(token, { authorization: 'Bearer ', 'x-evren-token': token }),
    true
  )
  check(
    'Bearer doluysa özel başlık yok sayılır',
    isAuthorized(token, { authorization: 'Bearer yanlis', 'x-evren-token': token }),
    false
  )

  console.log(`TOTAL=14 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
