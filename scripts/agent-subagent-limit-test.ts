/// <reference types="node" />
import {
  MAX_CONCURRENT_SUBAGENTS,
  MAX_SUBAGENTS_PER_REQUEST
} from '../src/shared/agentTopology'
import {
  createSubagentGate,
  limitMessage,
  type GateAcquireError
} from '../src/main/agent/subagentLimit'

/**
 * Alt ajan kapısı testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-subagent-limit-test.ts
 *
 * Neden: 0.4.5'e kadar alt ajan sayısı sınırsızdı. Bu test üç davranışı
 * sabitler: eşzamanlılık kuyruğu, istek başına bütçe reddi ve iptal.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function rejectionOf(promise: Promise<unknown>): Promise<GateAcquireError | null> {
  try {
    await promise
    return null
  } catch (error) {
    return error as GateAcquireError
  }
}

async function main(): Promise<void> {
  // ============ 1) Varsayılan sınırlar 6/6 ============
  {
    check('eşzamanlı tavan 6', MAX_CONCURRENT_SUBAGENTS, 6)
    check('istek başına tavan 6', MAX_SUBAGENTS_PER_REQUEST, 6)
    const gate = createSubagentGate()
    const snap = gate.snapshot()
    // Varsayılan 2: canlı koşuda 4 ajan + ana ajan aynı anda istek atınca
    // sağlayıcı "slow_down" döndürdü. Hard cap hâlâ 6 (açıkça istenirse).
    check('kapı varsayılanı eşzamanlı 2', snap.maxConcurrent, 2)
    check('kapı varsayılanı bütçe', snap.maxPerRequest, 6)
    const wide = createSubagentGate({ maxConcurrent: 6 })
    check('açıkça 6 istenebilir', wide.snapshot().maxConcurrent, 6)
    check('başlangıçta etkin 0', snap.active, 0)
  }

  // ============ 2) Kapasiteye kadar hemen verilir ============
  {
    const gate = createSubagentGate({ maxConcurrent: 3, maxPerRequest: 10 })
    for (let i = 0; i < 3; i++) {
      const error = await rejectionOf(gate.acquire('req'))
      check(`slot ${i + 1} verildi`, error, null)
    }
    check('etkin 3', gate.snapshot().active, 3)
    check('kuyruk boş', gate.snapshot().queued, 0)
  }

  // ============ 3) Kapasite dolunca kuyruk ============
  {
    const gate = createSubagentGate({ maxConcurrent: 2, maxPerRequest: 10 })
    await gate.acquire('req')
    await gate.acquire('req')
    let fourthResolved = false
    const pending = gate.acquire('req').then(() => {
      fourthResolved = true
    })
    await sleep(30)
    check('3. istek kuyrukta', gate.snapshot().queued, 1)
    check('3. istek henüz çalışmadı', fourthResolved, false)

    gate.release('req')
    await pending
    check('slot boşalınca kuyruk açıldı', fourthResolved, true)
    check('kuyruk boşaldı', gate.snapshot().queued, 0)
  }

  // ============ 4) İstek başına bütçe reddi ============
  {
    const gate = createSubagentGate({ maxConcurrent: 20, maxPerRequest: 3 })
    for (let i = 0; i < 3; i++) await gate.acquire('a')
    const error = await rejectionOf(gate.acquire('a'))
    check('4. istek reddedildi', error?.reason, 'per-request')
    check('bütçe 3 olarak sayıldı', gate.snapshot().used['a'], 3)

    // Farklı istek kendi bütçesine sahip.
    const other = await rejectionOf(gate.acquire('b'))
    check('başka istek reddedilmedi', other, null)
    check('istek bazlı sayım', gate.snapshot().used['b'], 1)
  }

  // ============ 5) Release bütçeyi geri vermez (ömürlük kota) ============
  {
    const gate = createSubagentGate({ maxConcurrent: 2, maxPerRequest: 2 })
    await gate.acquire('r')
    gate.release('r')
    await gate.acquire('r')
    gate.release('r')
    check('etkin 0', gate.snapshot().active, 0)
    const third = await rejectionOf(gate.acquire('r'))
    check('bütçe release ile geri gelmez', third?.reason, 'per-request')
  }

  // ============ 6) İptal: kuyruktan çıkar, bütçe geri verilir ============
  {
    const gate = createSubagentGate({ maxConcurrent: 1, maxPerRequest: 5 })
    await gate.acquire('x')
    const controller = new AbortController()
    const queued = gate.acquire('x', controller.signal)
    await sleep(20)
    check('kuyrukta 1', gate.snapshot().queued, 1)

    controller.abort()
    const error = await rejectionOf(queued)
    check('iptal reddi', error?.reason, 'aborted')
    check('kuyruk temizlendi', gate.snapshot().queued, 0)
    check('iptal edilen slot bütçeden düştü', gate.snapshot().used['x'], 1)
  }

  // ============ 7) Baştan iptal edilmiş sinyal ============
  {
    const gate = createSubagentGate()
    const controller = new AbortController()
    controller.abort()
    const error = await rejectionOf(gate.acquire('y', controller.signal))
    check('iptal hemen reddedilir', error?.reason, 'aborted')
    check('bütçe tüketilmedi', gate.snapshot().used['y'], undefined)
  }

  // ============ 8) Zaman aşımı ============
  {
    const gate = createSubagentGate({ maxConcurrent: 1, maxPerRequest: 5, queueTimeoutMs: 40 })
    await gate.acquire('t')
    const queued = gate.acquire('t')
    const error = await rejectionOf(queued)
    check('zaman aşımı', error?.reason, 'timeout')
    check('kuyruk boşaldı', gate.snapshot().queued, 0)
    check('zaman aşımı bütçeyi geri verir', gate.snapshot().used['t'], 1)
  }

  // ============ 9) release sırası FIFO ============
  {
    const gate = createSubagentGate({ maxConcurrent: 1, maxPerRequest: 10 })
    await gate.acquire('q')
    const order: number[] = []
    const p1 = gate.acquire('q').then(() => order.push(1))
    const p2 = gate.acquire('q').then(() => order.push(2))
    await sleep(10)
    gate.release('q')
    await p1
    gate.release('q')
    await p2
    check('sıra korundu', order, [1, 2])
  }

  // ============ 10) Fazla release etkin sayacı bozmaz ============
  {
    const gate = createSubagentGate({ maxConcurrent: 2, maxPerRequest: 4 })
    await gate.acquire('z')
    gate.release('z')
    gate.release('z')
    gate.release('z')
    check('etkin negatife düşmez', gate.snapshot().active, 0)
  }

  // ============ 11) reset ============
  {
    const gate = createSubagentGate({ maxConcurrent: 1, maxPerRequest: 2 })
    await gate.acquire('m')
    const queued = gate.acquire('m')
    await sleep(10)
    gate.reset()
    const error = await rejectionOf(queued)
    check('reset kuyruğu iptal eder', error?.reason, 'aborted')
    check('reset sayacı sıfırlar', gate.snapshot().active, 0)
    check('reset bütçeyi sıfırlar', gate.snapshot().used, {})
  }

  // ============ 12) Hata mesajı ============
  {
    const gate = createSubagentGate({ maxConcurrent: 1, maxPerRequest: 1 })
    await gate.acquire('msg')
    const error = await rejectionOf(gate.acquire('msg'))
    const text = limitMessage(error, gate.snapshot(), 'msg')
    check('mesaj bütçe diyor', text.includes('bütçesi doldu'), true)
    check('mesaj devam öneriyor', text.includes('devam et'), true)
    check('mesaj bütçe tüketimini gösteriyor', text.includes('kullanılan: 1/1'), true)

    const timeoutText = limitMessage({ reason: 'timeout' } as GateAcquireError)
    check('zaman aşımı mesajı', timeoutText.includes('zaman aşımına'), true)
  }

  // ============ 13) Gerçekçi senaryo: 6 paralel + 2 fazla ============
  {
    const gate = createSubagentGate({ maxConcurrent: 6 })
    const released: number[] = []
    const runs: Array<Promise<void>> = []
    for (let i = 0; i < 6; i++) {
      await gate.acquire('burst')
      runs.push(
        (async () => {
          await sleep(20)
          released.push(i)
          gate.release('burst')
        })()
      )
    }
    check('6 eşzamanlı çalışıyor', gate.snapshot().active, 6)
    const extra = await rejectionOf(gate.acquire('burst'))
    check('7. istek bütçe reddi', extra?.reason, 'per-request')
    await Promise.all(runs)
    check('hepsi bitti', released.length, 6)
    check('etkin 0', gate.snapshot().active, 0)
  }

  console.log(`TOTAL=42 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
