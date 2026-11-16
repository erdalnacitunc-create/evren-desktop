import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { UpdateStatus } from '../src/shared/types'
import {
  UPDATE_PHASE_KEYS,
  downloadPercent,
  updateButtonState
} from '../src/renderer/src/lib/updateButton'

/**
 * Üst çubuk güncelleme düğmesi testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/update-button-test.ts
 *
 * ## Neden
 *
 * Güncelleme akışı Ayarlar > Genel'de gömülüydü. Düğme üst çubuğa taşındığında
 * her fazda **ne yapacağı** net olmalı: idle → denetle, available → indir,
 * downloaded → kur, error → yeniden dene, disabled → gizle.
 * opencode/Antigravity deseni bu: tek tıkla akış ilerler.
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

const make = (phase: UpdateStatus['phase'], extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase,
  currentVersion: '0.4.21',
  canCheck: true,
  ...extra
})

app.whenReady().then(() => {
  // ============ 1) Faz → niyet ============
  {
    const idle = updateButtonState(make('idle'))
    check('idle görünür', idle.visible, true)
    check('idle niyeti denetle', idle.intent, 'check')
    check('idle tonu', idle.tone, 'idle')
    check('idle rozetsiz', idle.showDot, false)

    const notAvailable = updateButtonState(make('not-available'))
    check('güncel: denetle', notAvailable.intent, 'check')
    check('güncel: ton idle', notAvailable.tone, 'idle')

    const available = updateButtonState(make('available', { version: '0.4.22' }))
    check('available: indir', available.intent, 'download')
    check('available: ton', available.tone, 'available')
    check('available: rozet', available.showDot, true)
    check('available: tıklanabilir', available.disabled, false)

    const downloaded = updateButtonState(make('downloaded', { version: '0.4.22' }))
    check('downloaded: kur', downloaded.intent, 'install')
    check('downloaded: ton', downloaded.tone, 'ready')
    check('downloaded: rozetsiz', downloaded.showDot, false)

    const error = updateButtonState(make('error', { error: 'ağ hatası' }))
    check('error: yeniden dene', error.intent, 'retry')
    check('error: ton', error.tone, 'error')

    const checking = updateButtonState(make('checking'))
    check('checking: meşgul', checking.intent, 'busy')
    check('checking: devre dışı', checking.disabled, true)

    const downloading = updateButtonState(make('downloading', { percent: 42 }))
    check('downloading: meşgul', downloading.intent, 'busy')
    check('downloading: devre dışı', downloading.disabled, true)

    const disabled = updateButtonState(make('disabled'))
    check('disabled: gizli', disabled.visible, false)
    check('disabled: niyet', disabled.intent, 'hidden')
  }

  // ============ 2) canCheck kapalıysa ============
  {
    const blocked = updateButtonState(make('available', { canCheck: false }))
    check('canCheck yoksa devre dışı', blocked.disabled, true)
    check('canCheck yoksa yine görünür', blocked.visible, true)

    const blockedIdle = updateButtonState(make('idle', { canCheck: false }))
    check('idle canCheck yoksa devre dışı', blockedIdle.disabled, true)
  }

  // ============ 3) busy / null ============
  {
    const busyState = updateButtonState(make('available'), true)
    check('busy iken devre dışı', busyState.disabled, true)

    const none = updateButtonState(null)
    check('durum yoksa gizli', none.visible, false)
    check('durum yoksa devre dışı', none.disabled, true)
  }

  // ============ 4) Yüzde sıkıştırma ============
  {
    check('yüzde tam sayı', downloadPercent(42.6), 43)
    check('yüzde alt sınır', downloadPercent(-5), 0)
    check('yüzde üst sınır', downloadPercent(140), 100)
    check('yüzde tanımsız', downloadPercent(undefined), 0)
    check('yüzde NaN', downloadPercent(Number.NaN), 0)
    check('yüzde sıfır', downloadPercent(0), 0)
  }

  // ============ 5) Faz anahtarları tam ============
  {
    const phases: Array<UpdateStatus['phase']> = [
      'disabled',
      'idle',
      'checking',
      'available',
      'not-available',
      'downloading',
      'downloaded',
      'error'
    ]
    check('tüm fazlar eşlendi', phases.every((phase) => Boolean(UPDATE_PHASE_KEYS[phase])), true)
    check('anahtarlar update.phase ile başlar', Object.values(UPDATE_PHASE_KEYS).every((key) => key.startsWith('update.phase.')), true)
  }

  console.log(`TOTAL=30 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
