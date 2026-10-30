/// <reference types="node" />
import {
  MAX_PROMPT_HISTORY,
  canGoBack,
  canGoForward,
  currentPrompt,
  emptyHistory,
  historyFromPrompts,
  recallNext,
  recallPrevious,
  recordPrompt
} from '../src/renderer/src/lib/promptHistory'

/**
 * İstem geçmişi (geri/ileri) testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/prompt-history-test.ts
 */

let failed = 0

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

// --- tohumlama ---
const seeded = historyFromPrompts(['  bir  ', '', '   ', 'iki'])
check('boşlar ayıklanır, kırpılır', seeded.items, ['bir', 'iki'])
check('tohumlanan geçmiş taslak modunda', seeded.index, -1)

const many = historyFromPrompts(Array.from({ length: 130 }, (_, index) => `p${index}`))
check('en fazla 100 istem', many.items.length, MAX_PROMPT_HISTORY)
check('en yeni istem sonda', many.items[many.items.length - 1], 'p129')

// --- kayıt ---
let history = recordPrompt(emptyHistory(), '  ilk istem ')
check('boş geçmişe kayıt', history.items, ['ilk istem'])
check('kayıttan sonra taslak modu', history.index, -1)
history = recordPrompt(history, 'ikinci')
check('ikinci istem eklenir', history.items, ['ilk istem', 'ikinci'])
history = recordPrompt(history, 'ikinci')
check('art arda tekrar atlanır', history.items, ['ilk istem', 'ikinci'])
check('boş istem yok sayılır', recordPrompt(history, '   '), history)

// --- geri / ileri ---
let nav = historyFromPrompts(['a', 'b', 'c'])
nav = recallPrevious(nav, 'taslak metin')
check('geri: son istem', currentPrompt(nav, 'taslak metin'), 'c')
check('geri: taslak saklanır', nav.draft, 'taslak metin')
nav = recallPrevious(nav, 'taslak metin')
check('geri: bir önceki', currentPrompt(nav, 'taslak metin'), 'b')
nav = recallNext(nav)
check('ileri: sonraki', currentPrompt(nav, 'taslak metin'), 'c')
nav = recallNext(nav)
check('ileri: taslağa dönüş', currentPrompt(nav, 'taslak metin'), 'taslak metin')
check('taslağa dönünce index -1', nav.index, -1)

const oldest = recallPrevious(recallPrevious(historyFromPrompts(['a', 'b']), ''), '')
const stillOldest = recallPrevious(oldest, '')
check('en eskide geri durur', stillOldest, oldest)

const empty = emptyHistory()
check('boş geçmişte geri no-op', recallPrevious(empty, 'x'), empty)
check('boş geçmişte ileri no-op', recallNext(empty), empty)

// --- buton durumları ---
const fresh = historyFromPrompts(['a', 'b'])
check('taslakta geri açık', canGoBack(fresh), true)
check('taslakta ileri kapalı', canGoForward(fresh), false)
const single = recallPrevious(historyFromPrompts(['tek']), '')
check('tek istemde geri kapalı', canGoBack(single), false)
check('tek istemde ileri açık', canGoForward(single), true)
const newest = recallPrevious(fresh, '')
check('en yenide ileri açık', canGoForward(newest), true)

// --- gönderim sırasında gezinme ---
const whileNavigating = recordPrompt(recallPrevious(fresh, 'x'), 'yeni')
check('kayıt gezinmeyi sıfırlar', whileNavigating.index, -1)
check('kayıt yeni istemi ekler', whileNavigating.items, ['a', 'b', 'yeni'])

console.log(`TOTAL=${18} FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
