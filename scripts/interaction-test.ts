/// <reference types="node" />
import {
  approvalKey,
  rejectAllForRequest,
  resolveApproval,
  waitForApproval
} from '../src/main/agent/approval'
import {
  rejectAllQuestions,
  resolveQuestion,
  waitForQuestion
} from '../src/main/agent/question'

/**
 * Onay ve soru köprüsü testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/interaction-test.ts
 *
 * Bu iki köprü süreç ayrımında en kırılgan noktadır: çözücü kaybolursa ajan
 * sonsuza kadar bekler. Testler "her bekleyen eninde sonunda sonuçlanır"
 * kuralını doğrular.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

void runTests()

async function runTests(): Promise<void> {
  // --- onay: anahtar biçimi ---
  check('onay anahtarı', approvalKey('r1', 't1'), 'r1::t1')

  // --- onay: onaylama ---
  {
    const controller = new AbortController()
    const promise = waitForApproval(approvalKey('r1', 't1'), controller)
    check('çözücü kayıtlı', resolveApproval(approvalKey('r1', 't1'), true), true)
    check('onay true döner', await promise, true)
    check('ikinci çözüm false', resolveApproval(approvalKey('r1', 't1'), true), false)
  }

  // --- onay: reddetme ---
  {
    const controller = new AbortController()
    const promise = waitForApproval(approvalKey('r2', 't1'), controller)
    resolveApproval(approvalKey('r2', 't1'), false)
    check('ret false döner', await promise, false)
  }

  // --- onay: bilinmeyen anahtar ---
  check('bilinmeyen onay çözülemez', resolveApproval('yok::yok', true), false)

  // --- onay: abort öncesi ---
  {
    const controller = new AbortController()
    controller.abort()
    check('abort edilmiş hemen false', await waitForApproval('r3::t1', controller), false)
    check('abort sonrası çözücü yok', resolveApproval('r3::t1', true), false)
  }

  // --- onay: abort sonrası ---
  {
    const controller = new AbortController()
    const promise = waitForApproval('r4::t1', controller)
    controller.abort()
    check('abort false döndürür', await promise, false)
    check('abort kaydı temizler', resolveApproval('r4::t1', true), false)
  }

  // --- onay: istek bazlı temizlik ---
  {
    const c1 = new AbortController()
    const c2 = new AbortController()
    const p1 = waitForApproval('r5::a', c1)
    const p2 = waitForApproval('r5::b', c2)
    const other = waitForApproval('r6::a', new AbortController())
    rejectAllForRequest('r5')
    check('r5 birinci false', await p1, false)
    check('r5 ikinci false', await p2, false)
    check('r6 etkilenmez (çözülebilir)', resolveApproval('r6::a', true), true)
    check('r6 sonucu', await other, true)
  }

  // --- onay: aynı anahtar iki kez ---
  {
    const c1 = new AbortController()
    const c2 = new AbortController()
    const first = waitForApproval('r7::t1', c1)
    const second = waitForApproval('r7::t1', c2)
    check('ilk bekleyiş hemen reddedilir', await first, false)
    resolveApproval('r7::t1', true)
    check('ikinci bekleyiş sonucu alır', await second, true)
  }

  // --- soru: aynı anahtar iki kez ---
  {
    const first = waitForQuestion('s9', 'q1', new AbortController().signal)
    const second = waitForQuestion('s9', 'q1', new AbortController().signal)
    check('ilk soru null olur', await first, null)
    resolveQuestion('s9', 'q1', ['b'])
    check('ikinci soru cevabı alır', await second, ['b'])
  }

  // --- onay: çok sayıda bekleyen ---
  {
    const controllers = Array.from({ length: 20 }, () => new AbortController())
    const promises = controllers.map((controller, index) =>
      waitForApproval(`bulk::t${index}`, controller)
    )
    rejectAllForRequest('bulk')
    const results = await Promise.all(promises)
    check('20 bekleyen kapanır', results.every((value) => value === false), true)
  }

  // --- soru: cevap ---
  {
    const controller = new AbortController()
    const promise = waitForQuestion('s1', 'q1', controller.signal)
    check('soru çözülebilir', resolveQuestion('s1', 'q1', ['a', 'b']), true)
    check('cevaplar döner', await promise, ['a', 'b'])
    check('ikinci çözüm false', resolveQuestion('s1', 'q1', ['c']), false)
  }

  // --- soru: boş ve boşluk cevaplar ayıklanır ---
  {
    const controller = new AbortController()
    const promise = waitForQuestion('s2', 'q1', controller.signal)
    resolveQuestion('s2', 'q1', ['  ', 'a', ''])
    check('boş cevaplar filtrelenir', await promise, ['a'])
  }

  // --- soru: abort ---
  {
    const controller = new AbortController()
    const promise = waitForQuestion('s3', 'q1', controller.signal)
    controller.abort()
    check('abort null döner', await promise, null)
    check('abort sonrası çözüm yok', resolveQuestion('s3', 'q1', ['a']), false)
  }

  // --- soru: istek bazlı temizlik ---
  {
    const p1 = waitForQuestion('s4', 'q1', new AbortController().signal)
    const p2 = waitForQuestion('s4', 'q2', new AbortController().signal)
    const other = waitForQuestion('s5', 'q1', new AbortController().signal)
    rejectAllQuestions('s4')
    check('s4 q1 null', await p1, null)
    check('s4 q2 null', await p2, null)
    check('s5 etkilenmez', resolveQuestion('s5', 'q1', ['x']), true)
    check('s5 sonucu', await other, ['x'])
  }

  // --- soru: olmayan ---
  check('bilinmeyen soru çözülemez', resolveQuestion('yok', 'yok', ['a']), false)

  // --- karşılıklı etkileşim yok ---
  {
    const c = new AbortController()
    const approval = waitForApproval('mix::t1', c)
    const question = waitForQuestion('mix', 't1', c.signal)
    rejectAllForRequest('mix')
    rejectAllQuestions('mix')
    check('aynı istekte ikisi de kapanır', [await approval, await question], [false, null])
  }

  await flush()
  console.log(`TOTAL=33 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}
