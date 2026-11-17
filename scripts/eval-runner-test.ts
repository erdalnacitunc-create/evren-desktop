import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  CRITERIA,
  CRITERIA_WEIGHTS,
  buildJudgePrompt,
  combineResult,
  normalizeText,
  parseJudgeResponse,
  scoreBasic,
  scoreJudge,
  summarizeEvals,
  type BasicResult,
  type JudgeScore
} from '../src/main/agent/evalRunner'

/**
 * Eval koşucusu testleri (saf mantık, ağ yok).
 * Çalıştırma: node scripts/run-unit.cjs scripts/eval-runner-test.ts
 *
 * ## Neden
 *
 * 74 deterministik paket "kod yolu doğru mu" sorusunu yanıtlıyor. Eksik olan
 * "çıktı kaliteli mi". OpenAI Evals paternini uyguluyoruz: basic (kural) +
 * model-graded (hakem). Bu test koşucunun **saf** kısmını sabitler.
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
  // ============ 1) Normalizasyon ============
  {
    check('boşluk sadeleşir', normalizeText('  a   b  '), 'a b')
    check('Türkçe I küçülür', normalizeText('ISITMA'), 'ısıtma')
    check('Türkçe İ küçülür', normalizeText('İLETİŞİM'), 'iletişim')
    check('boş metin', normalizeText(''), '')
  }

  // ============ 2) Basic skor ============
  {
    const all: BasicResult[] = [
      { label: 'a', passed: true, weight: 1 },
      { label: 'b', passed: true, weight: 1 }
    ]
    check('hepsi geçti → 1', scoreBasic(all), 1)

    const half: BasicResult[] = [
      { label: 'a', passed: true, weight: 1 },
      { label: 'b', passed: false, weight: 1 }
    ]
    check('yarısı → 0.5', scoreBasic(half), 0.5)

    const weighted: BasicResult[] = [
      { label: 'kritik', passed: false, weight: 3 },
      { label: 'ufak', passed: true, weight: 1 }
    ]
    check('ağırlıklı → 0.25', scoreBasic(weighted), 0.25)

    check('ağırlıksız liste → 1', scoreBasic([{ label: 'x', passed: false, weight: 0 }]), 1)
    check('boş liste → 1', scoreBasic([]), 1)
  }

  // ============ 3) Hakem skoru ============
  {
    const perfect: JudgeScore[] = CRITERIA.map((criterion) => ({ criterion, score: 1 }))
    check('hepsi 1 → 1', scoreJudge(perfect), 1)

    const zero: JudgeScore[] = CRITERIA.map((criterion) => ({ criterion, score: 0 }))
    check('hepsi 0 → 0', scoreJudge(zero), 0)

    // Ağırlık: accuracy 0.3, efficiency 0.1
    const weighted: JudgeScore[] = [
      { criterion: 'accuracy', score: 1 },
      { criterion: 'efficiency', score: 0 }
    ]
    // (1*0.3 + 0*0.1) / (0.3+0.1) = 0.75
    check('ağırlıklı hakem → 0.75', scoreJudge(weighted), 0.75)

    // 0-10 ölçeği normalize edilir.
    check('0-10 ölçeği normalize', scoreJudge([{ criterion: 'accuracy', score: 8 }]), 0.8)

    // Sınır dışı sıkıştırılır.
    check('aşırı değer sıkışır', scoreJudge([{ criterion: 'accuracy', score: 50 }]), 1)

    check('boş hakem → 0', scoreJudge([]), 0)
    check('ağırlıklar toplamı 1', Math.round(Object.values(CRITERIA_WEIGHTS).reduce((a, b) => a + b, 0) * 10) / 10, 1)
  }

  // ============ 4) Hakem istemi ============
  {
    const prompt = buildJudgePrompt({
      title: 'Proje incelemesi',
      prompt: 'Bu projeyi incele',
      output: 'Rapor metni',
      evidence: 'main.cpp:12 satırı'
    })
    check('başlık var', prompt.includes('Proje incelemesi'), true)
    check('çıktı var', prompt.includes('Rapor metni'), true)
    check('kanıt var', prompt.includes('main.cpp:12'), true)
    check('beş ölçüt listelendi', CRITERIA.every((c) => prompt.includes(c)), true)
    check('JSON şeması isteniyor', prompt.includes('"scores"'), true)
    check('kanıt yoksa bölüm çıkar', buildJudgePrompt({ title: 't', prompt: 'p', output: 'o' }).includes('Araç kanıtı'), false)
  }

  // ============ 5) Hakem yanıtı ayrıştırma ============
  {
    const clean = parseJudgeResponse(
      '{"scores":[{"criterion":"accuracy","score":0.9,"reason":"iyi"},{"criterion":"honesty","score":0.8}]}'
    )
    check('temiz JSON', clean.length, 2)
    check('puan okundu', clean[0]?.score, 0.9)
    check('gerekçe okundu', clean[0]?.reason, 'iyi')

    const fenced = parseJudgeResponse(
      'İşte:\n```json\n{"scores":[{"criterion":"evidence","score":0.5}]}\n```'
    )
    check('kod bloğu içinden', fenced.length, 1)
    check('blok puanı', fenced[0]?.score, 0.5)

    check('bozuk JSON → boş', parseJudgeResponse('bu JSON değil').length, 0)
    check('bilinmeyen ölçüt atlanır', parseJudgeResponse('{"scores":[{"criterion":"uydurma","score":1}]}').length, 0)
    check('sayı olmayan puan atlanır', parseJudgeResponse('{"scores":[{"criterion":"accuracy","score":"çok"}]}').length, 0)
    check('string sayı kabul', parseJudgeResponse('{"scores":[{"criterion":"accuracy","score":"0.7"}]}')[0]?.score, 0.7)

    // ===== Kesik JSON kurtarma (0.4.23 canlı kusuru) =====
    // 0.4.22'de hakem token sınırında kesildi ve TÜM ölçüm kayboldu:
    //   {"scores":[{"criterion":"accuracy","score":0.8,"reason":"D
    const truncated =
      '{"scores":[{"criterion":"accuracy","score":0.8,"reason":"Desteklenmiyor"},' +
      '{"criterion":"evidence","score":0.4,"reason":"Az kanıt"},' +
      '{"criterion":"completeness","score":0.6,"reason":"Eksik"'
    const recovered = parseJudgeResponse(truncated)
    check('kesik JSON kurtarıldı', recovered.length, 3)
    check('kurtarılan puanlar doğru', recovered.map((s) => s.score), [0.8, 0.4, 0.6])
    check('ölçüt adları doğru', recovered.map((s) => s.criterion), [
      'accuracy',
      'evidence',
      'completeness'
    ])

    // Tekrar eden ölçüt ilk değeri korur.
    const duplicate = parseJudgeResponse(
      '{"scores":[{"criterion":"accuracy","score":0.3},{"criterion":"accuracy","score":0.9}]}'
    )
    check('tekrar eden ölçüt tek sayılır', duplicate.length, 1)
    check('ilk değer korunur', duplicate[0]?.score, 0.3)
  }

  // ============ 6) Sonuç birleştirme ============
  {
    const basicPass: BasicResult[] = [{ label: 'a', passed: true, weight: 1 }]
    const judgeGood: JudgeScore[] = CRITERIA.map((criterion) => ({ criterion, score: 1 }))

    const good = combineResult({
      id: 'e1',
      title: 't',
      output: 'o',
      basic: basicPass,
      judge: judgeGood
    })
    check('basic 1', good.basicScore, 1)
    check('hakem 1', good.judgeScore, 1)
    check('birleşik 1', good.score, 1)
    check('geçti', good.passed, true)

    const bad = combineResult({
      id: 'e2',
      title: 't',
      output: 'o',
      basic: [{ label: 'a', passed: false, weight: 1 }],
      judge: CRITERIA.map((criterion) => ({ criterion, score: 0 }))
    })
    check('kötü skor 0', bad.score, 0)
    check('kötü geçmedi', bad.passed, false)

    // Yalnız basic: hakem yoksa basic score kullanılır.
    const basicOnly = combineResult({
      id: 'e3',
      title: 't',
      output: 'o',
      basic: [{ label: 'a', passed: true, weight: 1 }]
    })
    check('hakemsiz basic skor', basicOnly.score, 1)
    check('hakemsiz judgeScore yok', basicOnly.judgeScore, undefined)

    // Eşik yapılandırılabilir.
    const strict = combineResult({
      id: 'e4',
      title: 't',
      output: 'o',
      basic: [{ label: 'a', passed: true, weight: 1 }],
      judge: [{ criterion: 'accuracy', score: 0.8 }],
      passThreshold: 0.95
    })
    check('yüksek eşik geçmedi', strict.passed, false)

    // Hata varsa geçmez.
    const errored = combineResult({
      id: 'e5',
      title: 't',
      output: '',
      basic: [{ label: 'a', passed: true, weight: 1 }],
      error: 'ajan çöktü'
    })
    check('hata geçmez', errored.passed, false)
    check('hata taşınır', errored.error, 'ajan çöktü')
  }

  // ============ 7) Toplu özet ============
  {
    const results = [
      combineResult({ id: 'a', title: 't', output: 'o', basic: [{ label: 'x', passed: true, weight: 1 }] }),
      combineResult({ id: 'b', title: 't', output: 'o', basic: [{ label: 'x', passed: false, weight: 1 }] }),
      combineResult({
        id: 'c',
        title: 't',
        output: 'o',
        basic: [{ label: 'x', passed: true, weight: 1 }],
        judge: [{ criterion: 'honesty', score: 0.2 }]
      })
    ]
    const summary = summarizeEvals(results)
    check('toplam', summary.total, 3)
    // 'c': basic 1 ama hakem 0.2 → (1+0.2)/2 = 0.6 < 0.7, geçmez.
    check('geçen', summary.passed, 1)
    check('başarısız kimlikler', summary.failedIds, ['b', 'c'])
    check('ortalama hesaplandı', summary.averageScore > 0 && summary.averageScore <= 1, true)
    check('en zayıf ölçüt honesty', summary.weakestCriterion, 'honesty')
  }

  console.log(`TOTAL=51 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
