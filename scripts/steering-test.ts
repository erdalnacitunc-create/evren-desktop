/// <reference types="node" />
import {
  MAX_STEERING_MESSAGES,
  clearAllSteering,
  clearSteering,
  countSteering,
  drainSteering,
  pushSteering
} from '../src/main/agent/steering'

/**
 * Araya girme (steering) kuyruğu testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/steering-test.ts
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

clearAllSteering()

// --- ekleme ---
check('boş metin reddedilir', pushSteering('r1', '   '), false)
check('boş metin sayılmaz', countSteering('r1'), 0)
check('metin eklenir', pushSteering('r1', '  önce şunu yap  '), true)
check('sayaç artar', countSteering('r1'), 1)
check('ikinci mesaj', pushSteering('r1', 'sonra bunu'), true)
check('sayaç iki', countSteering('r1'), 2)

// --- istekler birbirinden bağımsız ---
check('başka istek boş', countSteering('r2'), 0)

// --- boşaltma ---
check('sırayla ve kırpılmış döner', drainSteering('r1'), ['önce şunu yap', 'sonra bunu'])
check('boşaltınca sayaç sıfır', countSteering('r1'), 0)
check('ikinci boşaltma boş', drainSteering('r1'), [])
check('diğer istek etkilenmez', countSteering('r2'), 0)

// --- sınırlar ---
for (let index = 0; index < MAX_STEERING_MESSAGES; index++) {
  pushSteering('r3', `mesaj ${index}`)
}
check('sınırda sayaç', countSteering('r3'), MAX_STEERING_MESSAGES)
check('sınır aşılınca reddedilir', pushSteering('r3', 'fazla'), false)
check('sınır aşılınca sayaç değişmez', countSteering('r3'), MAX_STEERING_MESSAGES)

const long = 'a'.repeat(9000)
clearSteering('r4')
pushSteering('r4', long)
const drained = drainSteering('r4')
check('uzun metin kırpılır', drained[0]?.length, 8000)

// --- temizleme ---
pushSteering('r5', 'x')
clearSteering('r5')
check('tek istek temizlenir', countSteering('r5'), 0)
pushSteering('r6', 'y')
clearAllSteering()
check('tümü temizlenir', countSteering('r6'), 0)

// --- boşaltma sonrası yeni mesaj ---
pushSteering('r7', 'a')
drainSteering('r7')
pushSteering('r7', 'b')
check('boşaltmadan sonra yeniden kullanılabilir', drainSteering('r7'), ['b'])

console.log(`TOTAL=18 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
