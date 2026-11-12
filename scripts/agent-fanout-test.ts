/// <reference types="node" />
import {
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_STAGGER_MS,
  MAX_FANOUT_CONCURRENCY,
  planFanout,
  scopeBriefing,
  staggerDelayFor,
  validateFanout
} from '../src/shared/agentFanout'
import {
  MAX_CONCURRENT_SUBAGENTS,
  MAX_SUBAGENTS_PER_REQUEST
} from '../src/shared/agentTopology'

/**
 * Fan-out planlayıcı testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-fanout-test.ts
 *
 * Canlı kusur: model tek seferde 4 ajan başlattı → 5× ani istek artışı →
 * sağlayıcı "slow_down" → 11 retry. Ayrıca ajanlara 3 GB'lık build
 * dizinleri verildiği için "kısmi" rapor döndüler.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// ============ 1) Küçük kapsam: tek ajan ============
{
  const plan = planFanout({ fileCount: 5 })
  check('5 dosya → 1 ajan', plan.count, 1)
  check('tek ajan eşzamanlı', plan.concurrency, 1)
  check('tek ajanda gecikme yok', plan.staggerMs, 0)
  check('gerekçe dosya sayısını içeriyor', /5 dosya/.test(plan.reason), true)

  check('14 dosya hâlâ 1', planFanout({ fileCount: 14 }).count, 1)
  check('boş kapsam 2 (varsayılan)', planFanout({}).count, 2)
}

// ============ 2) Orta kapsam: 2 ajan ============
{
  const plan = planFanout({ fileCount: 30, directoryCount: 2 })
  check('30 dosya → 2 ajan', plan.count, 2)
  check('2 eşzamanlı', plan.concurrency, 2)
  check('kademeli gecikme var', plan.staggerMs > 0, true)

  const byDir = planFanout({ directoryCount: 2 })
  check('dosya yok, 2 dizin → 2 ajan', byDir.count, 2)
}

// ============ 3) Büyük kapsam: 3-4 ajan ama eşzamanlılık yine 2 ============
{
  const plan = planFanout({ fileCount: 900, directoryCount: 5 })
  check('900 dosya → 3-4 ajan', plan.count >= 3 && plan.count <= 4, true)
  check('eşzamanlılık en fazla 2', plan.concurrency, MAX_FANOUT_CONCURRENCY)
  check('dalga bilgisi gerekçede', /dalga/.test(plan.reason), true)
  check('ramp-rate gerekçede', /ramp-rate/.test(plan.reason), true)
}

// ============ 4) Basit sorgu: kapsam büyükse bile 1 ============
{
  const plan = planFanout({ fileCount: 40, complexity: 'simple' })
  check('basit + 40 dosya → 1 ajan', plan.count, 1)
  const complex = planFanout({ fileCount: 40, complexity: 'complex' })
  check('karmaşık + 40 dosya → 2 ajan', complex.count, 2)
}

// ============ 5) Hiçbir plan tavanları aşmaz ============
{
  let allValid = true
  const bad: string[] = []
  for (const fileCount of [0, 1, 10, 15, 59, 60, 300, 3000, 100000]) {
    for (const directoryCount of [0, 1, 2, 5, 20]) {
      for (const complexity of ['simple', 'moderate', 'complex'] as const) {
        const plan = planFanout({ fileCount, directoryCount, complexity })
        const problems = validateFanout(plan)
        if (problems.length > 0) {
          allValid = false
          bad.push(`${fileCount}/${directoryCount}/${complexity}: ${problems.join(', ')}`)
        }
      }
    }
  }
  check('tüm planlar geçerli', allValid, true)
  if (bad.length > 0) for (const line of bad.slice(0, 5)) console.log('   ', line)
}

// ============ 6) Eşzamanlılık asla ajan sayısını aşmaz ============
{
  let ok = true
  for (const fileCount of [1, 10, 20, 100, 1000, 10000]) {
    const plan = planFanout({ fileCount })
    if (plan.concurrency > plan.count) ok = false
  }
  check('eşzamanlılık ≤ ajan sayısı', ok, true)
}

// ============ 7) Kapsam dışı dizinler ============
{
  const plan = planFanout({ fileCount: 100 })
  check('node_modules dışlandı', plan.excludedDirs.includes('node_modules'), true)
  check('.pio dışlandı', plan.excludedDirs.includes('.pio'), true)
  check('build dışlandı', plan.excludedDirs.includes('build'), true)
  check('dist dışlandı', plan.excludedDirs.includes('dist'), true)
  check('dizin listesi dolu', DEFAULT_EXCLUDED_DIRS.length >= 10, true)
  check('gizli .git dışlandı', plan.excludedDirs.includes('.git'), true)
}

// ============ 8) Kademeli başlatma ============
{
  const plan = planFanout({ fileCount: 900, directoryCount: 5 })
  check('ilk ajan gecikmesiz', staggerDelayFor(0, plan), 0)
  check('ikinci ajan gecikir', staggerDelayFor(1, plan), plan.staggerMs)
  check('kuyruktaki ajan ek gecikme almaz', staggerDelayFor(3, plan), 0)
  check('varsayılan gecikme sabiti', DEFAULT_STAGGER_MS, 2000)

  const single = planFanout({ fileCount: 5 })
  check('tek ajanda kademe yok', staggerDelayFor(0, single), 0)
}

// ============ 9) Kapsam brifingi ============
{
  const text = scopeBriefing(planFanout({ fileCount: 100 }), 'C:\\proje')
  check('girme uyarısı var', /GİRME/.test(text), true)
  check('node_modules geçiyor', text.includes('node_modules'), true)
  check('kök yolu ekleniyor', text.includes('C:\\proje'), true)
  check('grep öneriyor', /grep/.test(text), true)
}

// ============ 10) Sabit tutarlılığı ============
{
  check('hard cap 6 korunuyor', MAX_CONCURRENT_SUBAGENTS, 6)
  check('istek tavanı 6', MAX_SUBAGENTS_PER_REQUEST, 6)
  check('fan-out eşzamanlılığı 2', MAX_FANOUT_CONCURRENCY, 2)
  check(
    'fan-out eşzamanlılığı hard cap altında',
    MAX_FANOUT_CONCURRENCY < MAX_CONCURRENT_SUBAGENTS,
    true
  )
}

// ============ 11) Deterministik ============
{
  const a = planFanout({ fileCount: 250, directoryCount: 4 })
  const b = planFanout({ fileCount: 250, directoryCount: 4 })
  check('aynı girdi aynı plan', JSON.stringify(a), JSON.stringify(b))
  check('excludedDirs kopyası bağımsız', a.excludedDirs !== b.excludedDirs, true)
}

// ============ 12) Gerçek plc_proje senaryosu ============
{
  // Canlı koşu: ~5 büyük dizin (firmware 4504, master 4956, mobil 4978 dosya)
  const plan = planFanout({
    fileCount: 14500,
    directoryCount: 5,
    complexity: 'complex',
    hasBuildArtifacts: true
  })
  check('plc_proje → 4 ajan', plan.count, 4)
  check('plc_proje → 2 eşzamanlı', plan.concurrency, 2)
  check('plc_proje → 2 dalga', Math.ceil(plan.count / plan.concurrency), 2)
  check('build dizinleri dışlandı', plan.excludedDirs.includes('build'), true)
}

console.log(`TOTAL=42 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
