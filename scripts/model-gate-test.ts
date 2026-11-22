/// <reference types="node" />
import { app } from 'electron'
import {
  DEFAULT_MODEL_CONCURRENCY,
  ModelGate,
  modelConcurrencyFromEnv
} from '../src/main/agent/modelGate'
import { mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Model istek kapısı testleri (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/model-gate-test.ts
 *
 * ## Neden
 *
 * 0.4.24 canlı koşusu 10 dk 42 sn sonra **tamamen düştü**: sağlayıcı "en fazla
 * 2 eşzamanlı istek" diyordu, biz ana ajan + 2 alt ajan = 3 gönderdik.
 * Bu test, kapının sayacının gerçekten tuttuğunu doğrular.
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  // ============ 1) Varsayılan ve ortam değişkeni ============
  {
    check('varsayılan 2', DEFAULT_MODEL_CONCURRENCY, 2)
    check('env yok → 2', modelConcurrencyFromEnv({}), 2)
    check('env 3 → 3', modelConcurrencyFromEnv({ EVREN_MODEL_CONCURRENCY: '3' } as never), 3)
    check('env 0 → varsayılan', modelConcurrencyFromEnv({ EVREN_MODEL_CONCURRENCY: '0' } as never), 2)
    check('env abc → varsayılan', modelConcurrencyFromEnv({ EVREN_MODEL_CONCURRENCY: 'abc' } as never), 2)
    check('env 99 → 8', modelConcurrencyFromEnv({ EVREN_MODEL_CONCURRENCY: '99' } as never), 8)
  }

  // ============ 2) Eşzamanlılık asla aşılmaz ============
  {
    const gate = new ModelGate(2)
    let active = 0
    let maxActive = 0
    const runs = Array.from({ length: 6 }, () =>
      (async () => {
        const release = await gate.acquire('sub')
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(5)
        active -= 1
        release()
      })()
    )
    await Promise.all(runs)
    check('eşzamanlılık üst sınırı korundu', maxActive, 2)
    check('sonra sayaç sıfır', gate.snapshot().active, 0)
    check('kuyruk boş', gate.snapshot().queued, 0)
  }

  // ============ 3) Ana ajan sırada beklerken alt ajan öne geçmez ============
  {
    const gate = new ModelGate(2)
    const order: string[] = []
    // İki alt ajan slotları doldurur.
    const sub1 = await gate.acquire('sub')
    const sub2 = await gate.acquire('sub')

    // Sırada: önce bir alt ajan, sonra ana ajan gelir.
    const subAgain = gate.acquire('sub').then((release) => {
      order.push('sub')
      release()
    })
    await sleep(1)
    const main = gate.acquire('main').then((release) => {
      order.push('main')
      release()
    })
    await sleep(1)

    // Bir slot boşalınca **ana ajan** girmeli (alt değil).
    sub1()
    await Promise.all([main, sleep(2)])
    check('ana ajan önce girdi', order[0], 'main')

    sub2()
    await Promise.all([subAgain, sleep(2)])
    check('sonra alt ajan girdi', order[1], 'sub')
  }

  // ============ 4) Kuyrukta iptal ============
  {
    const gate = new ModelGate(1)
    const release = await gate.acquire('main')
    const controller = new AbortController()
    const queued = gate.acquire('sub', controller.signal)
    controller.abort()
    let rejected = false
    try {
      await queued
    } catch {
      rejected = true
    }
    check('kuyruktaki istek iptal edilebilir', rejected, true)
    check('iptal slot sızdırmaz', gate.snapshot().queued, 0)
    release()
    check('slot bırakıldı', gate.snapshot().active, 0)
  }

  // ============ 5) Çift bırakma sayacı bozmaz ============
  {
    const gate = new ModelGate(2)
    const release = await gate.acquire('main')
    release()
    release()
    check('çift release sayaç bozmaz', gate.snapshot().active, 0)
    // Kapı hâlâ 2 slot sunabilmeli.
    const a = await gate.acquire('sub')
    const b = await gate.acquire('sub')
    check('iki slot açılabilir', gate.snapshot().active, 2)
    a()
    b()
  }

  // ============ 6) İptal edilmiş sinyalle hiç başlamaz ============
  {
    const gate = new ModelGate(1)
    const controller = new AbortController()
    controller.abort()
    let rejected = false
    try {
      await gate.acquire('sub', controller.signal)
    } catch {
      rejected = true
    }
    check('iptal edilmiş sinyal hemen reddeder', rejected, true)
    check('sayaç dokunulmadı', gate.snapshot().active, 0)
  }

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
