/// <reference types="node" />
import { queryUsbInventory } from '../src/main/agent/hardware'

/**
 * USB envanteri: ürün adı zenginleştirmesi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/usb-inventory-test.ts
 *
 * Neden var: canlı koşuda `usb_devices` yalnızca `FriendlyName` döndürdüğü
 * için (bileşik aygıtlarda "USB Bileşik Aygıt") model VID/PID'den marka
 * uydurdu — 0B05:6206 için "ASIX Ethernet" dedi, gerçekte C-Media ses.
 * Bu test, aygıtın kendi bildirdiği ürün adının envantere girdiğini doğrular.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

async function main(): Promise<void> {
  const inventory = await queryUsbInventory()

  console.log(`aygıt: ${inventory.devices.length}, seri port: ${inventory.serialPorts.length}`)

  // ===== 1) envanter boş değil =====
  check('aygıt bulundu', inventory.devices.length > 0, true)
  check('her aygıtta instanceId var', inventory.devices.every((d) => d.instanceId.length > 0), true)

  // ===== 2) VID/PID ayrıştırıldı =====
  const withVid = inventory.devices.filter((d) => d.vendorId)
  check('VID ayrıştırılan aygıt var', withVid.length > 0, true)
  check(
    'VID 4 karakter hex',
    withVid.every((d) => /^[0-9A-F]{4}$/.test(d.vendorId ?? '')),
    true
  )
  check(
    'PID 4 karakter hex',
    withVid.every((d) => /^[0-9A-F]{4}$/.test(d.productId ?? '')),
    true
  )

  // ===== 3) ürün adı alanı: en az bir aygıtta dolu =====
  const withProduct = inventory.devices.filter((d) => d.productName)
  check('en az bir ürün adı okundu', withProduct.length > 0, true)
  console.log(`ürün adı okunan: ${withProduct.length}/${inventory.devices.length}`)

  // ===== 4) genel INF etiketleri ürün adı sayılmaz =====
  check(
    'genel etiket filtrelendi',
    inventory.devices.every((d) => !d.productName?.startsWith('(')),
    true
  )
  check(
    'genel üretici filtrelendi',
    inventory.devices.every((d) => !d.manufacturer?.startsWith('(')),
    true
  )

  // ===== 5) bilinen bileşik aygıtlar çözüldü (bu makinede varsa) =====
  const audio = inventory.devices.find((d) => d.vendorId === '0B05' && d.productId === '6206')
  if (audio) {
    check('0B05:6206 ürün adı dolu', Boolean(audio.productName), true)
    check('0B05:6206 ASIX değil', /asix/i.test(audio.productName ?? ''), false)
    console.log(`  0B05:6206 → ${audio.productName} (üretici: ${audio.manufacturer ?? '-'})`)
  } else {
    console.log('  0B05:6206 bu makinede yok — atlandı')
  }

  const camera = inventory.devices.find((d) => d.vendorId === '2B7E')
  if (camera) {
    check('2B7E ürün adı dolu', Boolean(camera.productName), true)
    console.log(`  2B7E:${camera.productId} → ${camera.productName}`)
  } else {
    console.log('  2B7E bu makinede yok — atlandı')
  }

  // ===== 6) çıktı metni modele ürün adını taşıyor =====
  const { usbDeviceReport } = await import('../src/main/agent/hardware')
  const report = usbDeviceReport(inventory.devices)
  check('rapor ürün adı içeriyor', /—/.test(report), true)
  check('rapor tahmin uyarısı içeriyor', report.includes('tahmin etmeyin'), true)

  console.log(`TOTAL=12 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
