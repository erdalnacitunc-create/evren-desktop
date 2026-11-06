/// <reference types="node" />
import {
  MIN_CHAT_WIDTH,
  PANEL_SPECS,
  clampForViewport,
  clampPanelSize,
  resizeFromDrag,
  resizeFromKeyboard
} from '../src/renderer/src/lib/panelLayout'

/**
 * Panel yerleşimi testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/panel-layout-test.ts
 *
 * Neden: kenar panellerinin boyutu kullanıcı tercihidir ama sohbet kolonuna
 * her zaman okunabilir bir genişlik kalmalı. Canlı testte iki panel birlikte
 * genişleyince toolbar taşıyor ve yanlış öğeye tıklanıyordu.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const spec = PANEL_SPECS.workspace
const sessions = PANEL_SPECS.sessions

// ============ 1) Sınırlar ============
{
  check('varsayılan korunur', clampPanelSize(480, spec), 480)
  check('alt sınır', clampPanelSize(100, spec), spec.minSize)
  check('üst sınır', clampPanelSize(5000, spec), spec.maxSize)
  check('negatif güvenli', clampPanelSize(-50, spec), spec.minSize)
  check('NaN varsayılana', clampPanelSize(Number.NaN, spec), spec.defaultSize)
  check('ondalık yuvarlanır', clampPanelSize(333.7, spec), 334)
}

// ============ 2) Kullanılabilir alan sınırı ============
{
  // Alan sınırı doğrudan uygulanır (sohbet payı `clampForViewport`'ta düşülür).
  check('alan sınırı uygulanır', clampPanelSize(900, spec, 1000), 900)
  check('alan üst sınırı aşamaz', clampPanelSize(1200, spec, 1000), spec.maxSize)
  check('alan alt sınırı ezmez', clampPanelSize(100, spec, 300), spec.minSize)
  check('alan yoksa spec', clampPanelSize(800, spec, 0), 800)
}

// ============ 3) Pencere genişliğine göre ============
{
  // 1366 - 297 (sidebar) - 420 (sohbet) = 649
  check('sidebar varken sınır', clampForViewport(900, spec, 1366, 297), 649)
  check('dar pencerede alt sınır', clampForViewport(900, spec, 800, 300), spec.minSize)
  check('viewport yoksa spec', clampForViewport(700, spec, 0, 0), 700)
  check('MIN_CHAT_WIDTH sabiti', MIN_CHAT_WIDTH, 420)
}

// ============ 4) Sürükleme yönü ============
{
  // Sağ paneller: tutamak sol kenarda; sola sürükle → büyür.
  check('end: sola sürükle büyütür', resizeFromDrag(480, -150, 'end', spec), 630)
  check('end: sağa sürükle küçültür', resizeFromDrag(480, 150, 'end', spec), 330)
  // Sol paneller: tutamak sağ kenarda; sağa sürükle → büyür.
  check(
    'start: sağa sürükle büyütür',
    resizeFromDrag(290, 100, 'start', sessions),
    390
  )
  check(
    'start: sola sürükle küçültür',
    resizeFromDrag(290, -100, 'start', sessions),
    190
  )
  check('sürükleme alt sınırı aşamaz', resizeFromDrag(480, 900, 'end', spec), spec.minSize)
  check('sürükleme üst sınırı aşamaz', resizeFromDrag(480, -5000, 'end', spec), spec.maxSize)
}

// ============ 5) Klavye ============
{
  check('ArrowLeft büyütür (end)', resizeFromKeyboard(480, 'ArrowLeft', 'end', spec), 496)
  check('ArrowRight küçültür (end)', resizeFromKeyboard(480, 'ArrowRight', 'end', spec), 464)
  check('Shift büyük adım', resizeFromKeyboard(480, 'ArrowLeft', 'end', spec, undefined, 64), 544)
  check('start ArrowRight büyütür', resizeFromKeyboard(290, 'ArrowRight', 'start', sessions), 306)
  check('alakasız tuş null', resizeFromKeyboard(480, 'a', 'end', spec), null)
  check('Home null (hook ele alır)', resizeFromKeyboard(480, 'Home', 'end', spec), null)
  check('klavye alt sınır', resizeFromKeyboard(285, 'ArrowRight', 'end', spec), spec.minSize)
}

// ============ 6) Spec tutarlılığı ============
{
  for (const [id, value] of Object.entries(PANEL_SPECS)) {
    check(
      `${id}: default aralıkta`,
      value.defaultSize >= value.minSize && value.defaultSize <= value.maxSize,
      true
    )
    check(`${id}: min < max`, value.minSize < value.maxSize, true)
  }
}

// ============ 7) Deterministik ============
{
  const first = clampForViewport(640, spec, 1440, 290)
  const second = clampForViewport(640, spec, 1440, 290)
  check('aynı girdi aynı çıktı', first, second)
}

console.log(`TOTAL=39 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
