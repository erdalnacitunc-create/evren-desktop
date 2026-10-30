/// <reference types="node" />
import { app } from 'electron'
import { abortChat, steerChat } from '../src/main/chat'

/**
 * `steerChat` kapısı: yalnızca çalışan ve araya girilebilir bir isteğe
 * mesaj kabul edilir. Bilinmeyen istek kimliği sessizce reddedilir.
 *
 * Çalıştırma: node scripts/run-unit.cjs scripts/steer-gate-test.ts
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

app.whenReady().then(() => {
  check('bilinmeyen istek reddedilir', steerChat('yok-boyle-istek', 'merhaba'), {
    queued: false,
    pending: 0
  })
  check('boş metin bilinmeyen istekte yok sayılır', steerChat('', ''), {
    queued: false,
    pending: 0
  })
  check('bilinmeyen istek iptal edilemez', abortChat('yok-boyle-istek'), false)

  console.log(`TOTAL=3 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
