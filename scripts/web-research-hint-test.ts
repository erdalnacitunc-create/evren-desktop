/// <reference types="node" />
import {
  WEB_RESEARCH_HINT,
  emptyWebResearchState,
  shouldHintWebResearch
} from '../src/main/agent/explorationHint'

/**
 * Web araştırma ipucu testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/web-research-hint-test.ts
 *
 * ## Canlı bulgu (0.4.11, iki sorguluk sınamada)
 *
 * Yerel proje sorgusu: 169 sn, 12 araç, 7 read_file — alt ajan gerekmedi.
 * Web sorgusu: **384 sn**, 7 araç, **4 sıralı websearch** — bunlar bağımsızdı
 * ve paralel çalışabilirdi. Dosya keşfi için ipucu vardı, web için yoktu.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// ============ 1) Canlı koşudaki durum ============
{
  const state = { searches: 4, fetches: 2 }
  check('4 sıralı arama → ipucu', shouldHintWebResearch(state), true)
}

// ============ 2) Eşik ============
{
  check('1 arama → ipucu yok', shouldHintWebResearch({ searches: 1, fetches: 0 }), false)
  check('2 arama → ipucu yok', shouldHintWebResearch({ searches: 2, fetches: 0 }), false)
  check('3 arama → ipucu', shouldHintWebResearch({ searches: 3, fetches: 0 }), true)
  check('boş durum', shouldHintWebResearch(emptyWebResearchState()), false)
}

// ============ 3) Sayaç üst sınırı ============
{
  const state = { searches: 8, fetches: 0 }
  check('ilk ipucu', shouldHintWebResearch(state, 0, 1), true)
  check('ikinci ipucu yok', shouldHintWebResearch(state, 1, 1), false)
  check('maxHints=2 ikinci', shouldHintWebResearch(state, 1, 2), true)
  check('maxHints=0', shouldHintWebResearch(state, 0, 0), false)
}

// ============ 4) Eşik yapılandırılabilir ============
{
  check('minSearches 2', shouldHintWebResearch({ searches: 2, fetches: 0 }, 0, 1, 2), true)
  check('minSearches 6 altı', shouldHintWebResearch({ searches: 5, fetches: 0 }, 0, 1, 6), false)
  check('minSearches 1 → en az 2', shouldHintWebResearch({ searches: 1, fetches: 0 }, 0, 1, 1), false)
}

// ============ 5) fetch tek başına tetiklemez ============
{
  check('yalnızca fetch', shouldHintWebResearch({ searches: 0, fetches: 10 }), false)
  check('fetch + 3 arama', shouldHintWebResearch({ searches: 3, fetches: 5 }), true)
}

// ============ 6) İpucu metni ============
{
  check('spawn_agent öneriyor', WEB_RESEARCH_HINT.includes('spawn_agent'), true)
  check('paralel vurgusu', /paralel/i.test(WEB_RESEARCH_HINT), true)
  check('farklı konu istiyor', /FARKLI/.test(WEB_RESEARCH_HINT), true)
  check('kaynak türü istiyor', /kaynak türü/i.test(WEB_RESEARCH_HINT), true)
  check('task_wait öneriyor', WEB_RESEARCH_HINT.includes('task_wait'), true)
  check('bağlı aramada yok say diyor', /yok say/i.test(WEB_RESEARCH_HINT), true)
  check('2-4 ajan', /2-4/.test(WEB_RESEARCH_HINT), true)
}

// ============ 7) Deterministik ============
{
  const a = shouldHintWebResearch({ searches: 4, fetches: 1 })
  const b = shouldHintWebResearch({ searches: 4, fetches: 1 })
  check('aynı girdi aynı çıktı', a, b)
}

console.log(`TOTAL=22 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
