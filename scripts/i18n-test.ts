/// <reference types="node" />
import { en } from '../src/renderer/src/i18n/en'
import { tr } from '../src/renderer/src/i18n/tr'
import {
  DEFAULT_LOCALE,
  LOCALES,
  formatMessage,
  getLocale,
  isLocale,
  setLocale,
  translate
} from '../src/renderer/src/i18n'

/**
 * i18n altyapısı testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/i18n-test.ts
 *
 * Not: `useI18n` bir React hook'u olduğu için burada test edilmez; sözlük
 * bütünlüğü ve çeviri çözümlemesi doğrulanır.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

// --- sözlük bütünlüğü ---
const trKeys = Object.keys(tr).sort()
const enKeys = Object.keys(en).sort()
const missingInEn = trKeys.filter((key) => !(key in en))
const extraInEn = enKeys.filter((key) => !(key in tr))
check('en eksik anahtar yok', missingInEn, [])
check('en fazla anahtar yok', extraInEn, [])
check('boş çeviri yok (tr)', trKeys.filter((key) => !tr[key as keyof typeof tr].trim()), [])
check('boş çeviri yok (en)', enKeys.filter((key) => !en[key as keyof typeof en].trim()), [])

// --- yer tutucu tutarlılığı ---
const placeholder = (value: string): string[] =>
  (value.match(/\{(\w+)\}/g) ?? []).sort()
const mismatched = trKeys.filter((key) => {
  const a = placeholder(tr[key as keyof typeof tr])
  const b = placeholder(en[key as keyof typeof en])
  return JSON.stringify(a) !== JSON.stringify(b)
})
check('yer tutucular aynı', mismatched, [])

// --- dil doğrulama ---
check('tr geçerli', isLocale('tr'), true)
check('en geçerli', isLocale('en'), true)
check('de geçersiz', isLocale('de'), false)
check('boş geçersiz', isLocale(''), false)
check('sayı geçersiz', isLocale(1), false)
check('desteklenen diller', LOCALES, ['tr', 'en'])
check('varsayılan dil', DEFAULT_LOCALE, 'tr')

// --- çeviri çözümleme ---
check('varsayılan dil tr', getLocale(), 'tr')
check('tr çevirisi', translate('composer.send'), 'Gönder')
setLocale('en')
check('dil değişti', getLocale(), 'en')
check('en çevirisi', translate('composer.send'), 'Send')
check('yer tutucu doldurma', translate('update.available', { version: '1.2.3' }), 'New version: 1.2.3')
check('eksik parametre korunur', translate('update.available'), 'New version: {version}')
setLocale('tr')
check('tr yer tutucu', translate('update.available', { version: '1.2.3' }), 'Yeni sürüm: 1.2.3')

// --- biçimlendirme ---
check('birden çok yer tutucu', formatMessage('{a} ve {b}', { a: 'x', b: 'y' }), 'x ve y')
check('sayı yer tutucu', formatMessage('{count} model', { count: 3 }), '3 model')
check('parametresiz', formatMessage('düz metin'), 'düz metin')
check('bilinmeyen yer tutucu korunur', formatMessage('{a}', { b: 1 }), '{a}')
check('yinelenen yer tutucu', formatMessage('{a}-{a}', { a: 'z' }), 'z-z')

console.log(`TOTAL=24 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
