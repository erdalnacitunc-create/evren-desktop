/// <reference types="node" />
import {
  VOLATILE_MEMORY_CAVEAT,
  demoteVolatileEntries,
  isVolatileMemory,
  volatileReason,
  volatileReasonLabel
} from '../src/main/memory/memoryGuard'

/**
 * Anı geçiciliği testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/memory-guard-test.ts
 *
 * Canlı koşuda gözlendi: 1 Kasım'da kaydedilen yanlış bir VID/PID anısı
 * ("0B05:6206 = ASIX Ethernet") iki hafta sonra gemma'yı yanılttı.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// ============ 1) Gerçek yanlış anı ============
{
  const bad =
    'Bağlı USB aygıtları arasında ASIX Electronics Corp Gigabit Ethernet adaptörü (VID_0B05&PID_6206) ve VID_2B7E&PID_B597 kimlikli bir aygıt bulunmaktadır.'
  check('ASIX anısı geçici', volatileReason(bad), 'usb-inventory')
  check('etiket doğru', volatileReasonLabel(volatileReason(bad)!), 'USB envanteri (VID/PID)')

  const ports =
    'Sistemde COM5, COM7 ve COM9 portlarında üç adet Silicon Labs CP210x USB to UART Bridge bulunmaktadır.'
  check('port listesi geçici', volatileReason(ports), 'usb-inventory')
}

// ============ 2) Seri port listesi ============
{
  check('iki COM portu', volatileReason('COM5 ve COM7 kullanılıyor.'), 'serial-port')
  check('tek COM portu envanter değil', volatileReason('COM5 kullanılıyor.'), null)
  check('ttyUSB', volatileReason('ttyUSB0 ve ttyUSB1 cihazları var.'), 'serial-port')
  check('ttyACM', volatileReason('ttyACM2 bağlı.'), 'serial-port')
}

// ============ 3) Ağ adresi ============
{
  check('IP adresi', volatileReason('Modem 192.168.1.166 adresinde.'), 'network-address')
  check('MAC adresi', volatileReason('MAC: b4:bf:e9:05:12:1c'), 'network-address')
  check('RSSI', volatileReason('Sinyal gücü -66 dBm.'), 'network-address')
  check('SSID bağlı', volatileReason('iye-05121c SSID ağına bağlı.'), 'network-address')
}

// ============ 4) Aygıt bağlantı durumu ============
{
  check(
    'bağlı değil',
    volatileReason('ASIX USB Ethernet ve TP-Link 4G modem şu an takılı değil.'),
    'device-connection'
  )
  check(
    'şu anda bağlı',
    volatileReason('Şu anda bağlı herhangi bir Android cihaz algılanmadı.'),
    'device-connection'
  )
  check('durum yok', volatileReason('USB taraması tamamlandı.'), null)
}

// ============ 5) Araç sürümü ============
{
  check('esptool sürümü', volatileReason('esptool 5.3.1 kurulu.'), 'tool-version')
  check('Python sürümü', volatileReason('Python 3.13.12 kullanılıyor.'), 'tool-version')
  check('pyserial', volatileReason('pyserial 3.5 var.'), 'tool-version')
}

// ============ 6) Araç kullanılabilirliği ============
{
  check(
    'kabuk yok',
    volatileReason('Bu ortamda kabuk/terminal aracı yok; adb komutları doğrudan çalıştırılamıyor.'),
    'tool-availability'
  )
  check(
    'terminal yok',
    volatileReason('Terminal aracı mevcut değil.'),
    'tool-availability'
  )
}

// ============ 7) Dosya yolu ============
{
  check('Windows kullanıcı yolu', volatileReason('Proje C:\\Users\\erdal\\Desktop altında.'), 'filesystem-path')
  check('Program Files', volatileReason('Kurulum C:\\Program Files\\EVREN içinde.'), 'filesystem-path')
}

// ============ 8) Kalıcı anılar YANLIŞLIKLA elenmemeli ============
{
  const durable = [
    'Kullanıcı salt-okunur yaklaşım benimsiyor; ayar değiştiren komutlar kullanılmayacak.',
    'Kullanıcı yanıtları Türkçe istiyor.',
    'Proje kararı: Windows x64 ve Pardus x64 hedefleniyor, 32-bit desteklenmeyecek.',
    'Kullanıcı commit mesajlarında Türkçe tercih ediyor.',
    'Referans: OpenCode kaynak ağacı karşılaştırma için kullanılıyor.',
    'Sürüm numaralandırması 0.x beta olarak ilerliyor.',
    'Kullanıcının ESP32 geliştirme kartlarıyla çalıştığı bir projesi var.'
  ]
  for (const text of durable) {
    check(`kalıcı: ${text.slice(0, 38)}…`, volatileReason(text), null)
  }
}

// ============ 9) Yardımcılar ============
{
  check('boş metin', volatileReason(''), null)
  check('isVolatileMemory true', isVolatileMemory('VID_1234'), true)
  check('isVolatileMemory false', isVolatileMemory('Kullanıcı Türkçe istiyor.'), false)
  check('uyarı metni dolu', VOLATILE_MEMORY_CAVEAT.length > 20, true)
  check('uyarı doğrulama istiyor', /doğrula/i.test(VOLATILE_MEMORY_CAVEAT), true)
}

// ============ 10) Deterministik ============
{
  const text = 'COM5, COM7 ve COM9 portları bağlı.'
  const first = volatileReason(text)
  const second = volatileReason(text)
  check('aynı girdi aynı çıktı', first, second)
}

// ============ 11) Göç: eski kayıtları işaretle ============
{
  // Gerçek kullanıcı dosyasındaki 13 anının birebir kopyası (metin olarak).
  const legacy: Array<{ text: string; volatile?: boolean; volatileKind?: string }> = [
    { text: 'Kullanıcının geliştirici modu açık bir Android telefonu var ve bilgisayara bağlı.' },
    { text: 'Bağlı cihaz incelenirken salt-okunur yaklaşım benimsendi; ayar değiştiren komutlar (set/pm/rm) kullanılmayacak.' },
    { text: 'Bu ortamda kabuk/terminal aracı yok; adb komutları doğrudan çalıştırılamıyor.' },
    { text: 'Kullanıcının USB portuna bağlı TP-Link 4G modem bulunuyor.' },
    { text: 'Sistemde COM5, COM7 ve COM9 portlarında üç adet Silicon Labs CP210x USB to UART Bridge bulunmaktadır.' },
    { text: 'Bağlı USB aygıtları arasında ASIX Electronics Corp Gigabit Ethernet adaptörü (VID_0B05&PID_6206) ve VID_2B7E&PID_B597 kimlikli bir aygıt bulunmaktadır.' }
  ]
  const demoted = demoteVolatileEntries(legacy)
  check('işaretlenen sayı', demoted, 5)
  check('salt-okunur anı korundu', legacy[1]?.volatile, false)
  check('ASIX anısı geçici', legacy[5]?.volatile, true)
  check('COM listesi geçici', legacy[4]?.volatileKind, 'usb-inventory')

  // İdempotent: ikinci geçiş hiçbir şeyi değiştirmez.
  const second = demoteVolatileEntries(legacy)
  check('ikinci geçiş işaretlemez', second, 0)
  check('işaretler korunur', legacy[5]?.volatile, true)

  // Zaten `volatile: false` olan kayıt yeniden sınıflandırılmaz.
  const pinned: Array<{ text: string; volatile?: boolean }> = [{ text: 'VID_1234', volatile: false }]
  check('açık false korunur', demoteVolatileEntries(pinned), 0)
  check('açık false değişmedi', pinned[0]?.volatile, false)
}

console.log(`TOTAL=43 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
