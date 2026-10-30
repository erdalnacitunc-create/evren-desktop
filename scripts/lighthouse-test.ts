/// <reference types="node" />
import {
  LIGHTHOUSE_CATEGORIES,
  lighthouseMarkdown,
  normalizeAuditUrl,
  scoreToPercent,
  summarizeLighthouse
} from '../src/main/lighthouse'

/**
 * Lighthouse özetleme testleri (ağ/Chrome gerektirmez).
 * Çalıştırma: node scripts/run-unit.cjs scripts/lighthouse-test.ts
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

// --- URL doğrulama ---
check('https kabul', normalizeAuditUrl('https://example.com'), { ok: true, url: 'https://example.com/' })
check('http kabul', normalizeAuditUrl('http://example.com/a?b=1').ok, true)
check('file reddedilir', normalizeAuditUrl('file:///C:/tmp/a.html').ok, false)
check('boşluk kırpılır', normalizeAuditUrl('  https://a.b  ').ok, true)
check('boş reddedilir', normalizeAuditUrl('   '), { ok: false, error: 'Adres boş.' })
check('geçersiz reddedilir', normalizeAuditUrl('example.com').ok, false)
check('javascript: reddedilir', normalizeAuditUrl('javascript:alert(1)').ok, false)
check('data: reddedilir', normalizeAuditUrl('data:text/html,<h1>x</h1>').ok, false)
check('ftp reddedilir', normalizeAuditUrl('ftp://a.b').ok, false)

// --- skor dönüşümü ---
check('0.94 → 94', scoreToPercent(0.94), 94)
check('1 → 100', scoreToPercent(1), 100)
check('0 → 0', scoreToPercent(0), 0)
check('null → null', scoreToPercent(null), null)
check('undefined → null', scoreToPercent(undefined), null)
check('aralık dışı kırpılır (üst)', scoreToPercent(1.4), 100)
check('aralık dışı kırpılır (alt)', scoreToPercent(-0.2), 0)
check('NaN → null', scoreToPercent(Number.NaN), null)

// --- özetleme ---
const lhr = {
  finalUrl: 'https://example.com/',
  fetchTime: '2026-10-31T10:00:00.000Z',
  categories: {
    performance: { score: 0.82 },
    accessibility: { score: 0.95 },
    'best-practices': { score: 1 },
    seo: { score: 0.9 },
    pwa: { score: 0.5 }
  },
  audits: {
    'largest-contentful-paint': { title: 'LCP', score: 0.7, displayValue: '2.4 s' },
    'total-blocking-time': { title: 'TBT', score: 0.3, displayValue: '810 ms' },
    'cumulative-layout-shift': { title: 'CLS', score: 1, displayValue: '0' },
    'color-contrast': { title: 'Kontrast', score: 0, displayValue: '' },
    'not-scored': { title: 'Bilgi', score: null },
    'first-contentful-paint': { title: 'FCP', score: 0.9, displayValue: '1.2 s' }
  },
  runWarnings: ['Uyarı bir', 'Uyarı iki']
}

const summary = summarizeLighthouse(lhr)
check('bilinen kategoriler', summary.scores, {
  performance: 82,
  accessibility: 95,
  'best-practices': 100,
  seo: 90
})
check('url korunur', summary.url, 'https://example.com/')
check('pwa raporlanmaz', 'pwa' in summary.scores, false)
check('puansız denetim atlanır', summary.audits.some((a) => a.id === 'not-scored'), false)
check('en kötü puan önce', summary.audits[0]?.id, 'color-contrast')
check('displayValue korunur', summary.audits.find((a) => a.id === 'largest-contentful-paint')?.displayValue, '2.4 s')
check('uyarılar taşınır', summary.warnings.slice(0, 2), ['Uyarı bir', 'Uyarı iki'])

const withRuntime = summarizeLighthouse({
  ...lhr,
  runtimeError: { message: 'kabuk çöktü' }
})
check('runtime hatası uyarıya eklenir', withRuntime.warnings[0], 'runtime: kabuk çöktü')

const extra = summarizeLighthouse(lhr, ['not-scored'])
check('ek denetim kimliği kabul edilir', extra.audits.some((a) => a.id === 'not-scored'), false)

// --- markdown ---
const md = lighthouseMarkdown(summary)
check('markdown başlık', md.split('\n')[0], '# Lighthouse — https://example.com/')
check('markdown kategori satırı', md.includes('| Performans | 82 |'), true)
check('markdown denetim listesi', md.includes('**0** · Kontrast'), true)
check('markdown uyarı bölümü', md.includes('## Uyarılar'), true)

check('kategori listesi', LIGHTHOUSE_CATEGORIES.length, 4)

console.log(`TOTAL=32 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
