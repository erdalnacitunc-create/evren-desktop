/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { formatReviewBrief } from '../src/main/agent/reviewBrief'

/**
 * İnceleme paketi testleri (0.4.24).
 * Çalıştırma: node scripts/run-unit.cjs scripts/review-brief-test.ts
 *
 * ## Neden
 *
 * `review` alt ajanı geçmişsiz çalışır (kodu yazan konuşmayı görmez) — bu
 * doğru. Eksik olan neyi inceleyeceğiydi: diff'i kendisi arıyor, adım
 * bütçesini yakıyordu. Bu test, hazır bağlamın doğru, sınırlı ve
 * **uydurmasız** üretildiğini doğrular.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
let total = 0
function check(label: string, actual: unknown, expected: unknown): void {
  total += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}
function contains(label: string, text: string, needle: string, expected = true): void {
  total += 1
  const ok = text.includes(needle) === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

app.whenReady().then(() => {
  // ============ 1) Değişiklik yoksa brief yok ============
  {
    const brief = formatReviewBrief([])
    check('boş liste → boş metin', brief.text, '')
    check('boş liste → dosya yok', brief.files, [])
    check('boş liste → eksik yok', brief.omitted, 0)
  }

  // ============ 2) Dosya listesi ve diff ============
  {
    const brief = formatReviewBrief([
      {
        path: 'src/auth/token.ts',
        action: 'edit',
        diff: '@@ -1,3 +1,4 @@\n-const a = 1\n+const a = 2\n+const b = 3'
      },
      { path: 'src/old.ts', action: 'delete', diff: '@@ -1 +0,0 @@\n-export {}' }
    ])
    contains('başlıkta değişiklik sayısı', brief.text, 'Değişen dosyalar (2)')
    contains('dosya yolu listede', brief.text, 'src/auth/token.ts')
    contains('düzenleme etiketi', brief.text, 'düzenlendi')
    contains('silme etiketi', brief.text, 'silindi')
    contains('diff gövdesi eklenir', brief.text, '+const b = 3')
    contains('görev yönergesi var', brief.text, 'Görev belirli dosyaları')
    check('dosya listesi doğru', brief.files, ['src/auth/token.ts', 'src/old.ts'])
  }

  // ============ 3) maxChars sınırı ve eksik sayısı ============
  {
    const changes = Array.from({ length: 6 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      action: 'edit',
      diff: `@@ -1 +1 @@\n-${'a'.repeat(200)}\n+${'b'.repeat(200)}`
    }))
    const brief = formatReviewBrief(changes, 900)
    check('sınır aşılmaz', brief.text.length <= 900 + 200, true)
    check('eksik dosya bildirilir', brief.omitted > 0, true)
    contains('eksik dosya notu', brief.text, "diff'i sığmadı")
  }

  // ============ 4) Tek dev diff kırpılır, uydurma yok ============
  {
    const brief = formatReviewBrief([
      { path: 'src/huge.ts', action: 'write', diff: `+${'x'.repeat(9000)}` }
    ])
    contains('dev diff kırpılır', brief.text, 'diff kısaltıldı')
    check('dev diff sınırı', brief.text.length < 6000, true)
  }

  // ============ 5) Diff'i olmayan değişiklik yine listelenir ============
  {
    const brief = formatReviewBrief([{ path: 'yeni/dosya.ts', action: 'write', diff: '' }])
    contains('diff boşsa dosya yine listede', brief.text, 'yeni/dosya.ts')
    check('diff boşsa eksik sayılmaz', brief.omitted, 0)
  }

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
