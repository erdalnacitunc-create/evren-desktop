/// <reference types="node" />
import { app } from 'electron'
import { applyReportBudget, countWords } from '../src/main/agent/subagent'
import { mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Alt ajan rapor bütçesi testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/report-budget-test.ts
 *
 * ## Neden (0.4.19)
 *
 * 0.4.18 üç fazlı canlı koşusu: alt ajan adımı başına ortalama **88 sn**, araç
 * süresi payı **<%2**, en uzun tek adım **503 sn**, faz 2'de **3/3 kısmi**.
 * Zaman araçlarda değil, modelin tek parçada 4-8 bin karakterlik rapor
 * üretmesinde. İstem 450 kelimeye indirildi; kod tarafında da zorlanıyor ki
 * model sınırı aşsa bile sonuç kesilsin.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

app.whenReady().then(() => {
  // ============ 1) Kelime sayımı ============
  {
    check('boş metin', countWords(''), 0)
    check('yalnızca boşluk', countWords('   \n\t '), 0)
    check('tek kelime', countWords('merhaba'), 1)
    check('üç kelime', countWords('bir iki üç'), 3)
    check('satır sonları sayılır', countWords('bir\niki\r\nüç'), 3)
  }

  // ============ 2) Sınır altındaki metin değişmez ============
  {
    const short = '## Başlık\n- madde bir\n- madde iki'
    const result = applyReportBudget(short, 450)
    check('kısa metin korunur', result.text, short)
    check('kısa metin kesilmedi', result.truncated, false)
    check('kelime sayısı doğru', result.words, 8)
  }

  // ============ 3) Sınır aşılırsa kesilir ============
  {
    const paragraph = 'Bu cümle bilgi taşır. '.repeat(200) // ~800 kelime
    const result = applyReportBudget(paragraph, 450)
    check('uzun metin kesildi', result.truncated, true)
    check('özgün kelime sayısı korundu', result.words > 450, true)
    check('kesilmiş metin sınırı aşmaz', countWords(result.text) <= 470, true)
    check('kesme notu eklendi', result.text.includes('kelime bütçesine kısaltıldı'), true)
  }

  // ============ 4) Cümle ortasında kesmez ============
  {
    const sentences = Array.from({ length: 120 }, (_, i) => `Madde ${i} anlatılır.`).join(' ')
    const result = applyReportBudget(sentences, 50)
    const lastLine = result.text.split('\n')[0]!.trimEnd()
    check('kesme cümle sonunda', lastLine.endsWith('.'), true)
    check('not ayri satırda', result.text.includes('\n\n_['), true)
  }

  // ============ 5) Madde işaretli raporda satır sınırı ============
  {
    const bullets = Array.from({ length: 300 }, (_, i) => `- Bulgu ${i}: ayrıntı`).join('\n')
    const result = applyReportBudget(bullets, 100)
    check('madde raporu kesildi', result.truncated, true)
    check('satır ortasında kesmez', /- Bulgu \d+: ayrıntı\n/.test(`${result.text}`), true)
  }

  // ============ 6) Tam sınırdaki metin kesilmez ============
  {
    const exact = Array.from({ length: 450 }, (_, i) => `k${i}`).join(' ')
    const result = applyReportBudget(exact, 450)
    check('tam sınır kesilmez', result.truncated, false)
    check('tam sınır korunur', countWords(result.text), 450)
  }

  // ============ 7) Sınır bir fazla ============
  {
    const over = Array.from({ length: 451 }, (_, i) => `k${i}`).join(' ')
    const result = applyReportBudget(over, 450)
    check('sınır + 1 kesilir', result.truncated, true)
    check('en fazla sınır kadar kelime', countWords(result.text) <= 470, true)
  }

  // ============ 8) Varsayılan sınır 450 ============
  {
    const many = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ')
    const result = applyReportBudget(many)
    check('varsayılan 450 uygulandı', countWords(result.text) <= 470, true)
    check('varsayılan kesme notu', result.text.includes('450 kelime'), true)
  }

  // ============ 9) Türkçe metin ============
  {
    const turkish = Array.from({ length: 500 }, () => 'çğıöşü ÇĞİÖŞÜ veri').join(' ')
    const result = applyReportBudget(turkish, 100)
    check('Türkçe karakterler korunur', /çğıöşü/.test(result.text), true)
    check('Türkçe metin kesildi', result.truncated, true)
  }

  console.log(`TOTAL=24 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
