/**
 * Anı geçiciliği (volatility) sınıflandırması.
 *
 * ## Sorun
 *
 * Canlı koşuda gözlendi: 1 Kasım'da bir oturum "VID_0B05&PID_6206 = ASIX
 * Gigabit Ethernet" diye bir anı kaydetti. Bu bilgi **yanlıştı** (aygıt
 * C-Media ses kartı). İki hafta sonra gemma adlı model o anıyı okuyup aynı
 * yanlışı tekrarladı; mimo ise "önceki kayıtlarda ASIX yazıyordu" diye
 * şüphelendi ama yine de yanlış bilgiyi dolaşıma soktu.
 *
 * Aynı dosyada başka bayat kayıtlar da vardı:
 *  - "Bu ortamda kabuk/terminal aracı yok" (artık var)
 *  - "USB portuna bağlı TP-Link 4G modem bulunuyor" (artık bağlı değil)
 *  - "Kullanıcının bağlı Android telefonu var" (o an bağlı değil)
 *
 * ## Kural
 *
 * **Hafıza, araçların ucuzca yeniden türetebileceği şeyleri tutmamalı.**
 * Takılı USB aygıtları, COM portları, IP adresleri, kurulu araç sürümleri —
 * hepsi tek bir araç çağrısıyla güncel hâliyle öğrenilebilir. Hafızada
 * tuttuklarında eskimek zorunda kalırlar ve modelin yanlış cevap vermesine
 * yol açarlar.
 *
 * Bu modül iki yerde kullanılır:
 *  1. `extract.ts` — bu sınıfa giren adayları **kaydetmez**.
 *  2. `store.ts` / `retrieve.ts` — eski sürümlerin kaydettiği anılar
 *     silinmez, `volatile` olarak işaretlenir ve modele "geçmiş gözlem,
 *     doğrula" uyarısıyla verilir.
 *
 * ## Türkçe notu
 *
 * JavaScript'in `\b` sınırı ASCII tabanlıdır: `ş`, `ı`, `ğ` gibi harfler
 * `\w` sayılmadığı için `\bşu` hiç eşleşmez. Bu yüzden Türkçe sözcüklerde
 * `\b` yerine kök eşleşmesi (`bağ`, `takılı`, `araç`) kullanılır. Sözcük
 * çekimleri (`bağlı`, `bağlantılı`) böylece doğru yakalanır.
 *
 * Saf fonksiyondur: yan etkisi yoktur, test edilebilir.
 */

/** Geçici gözlem nedeni. `null` ise kalıcı bilgi sayılır. */
export type VolatileReason =
  | 'usb-inventory'
  | 'serial-port'
  | 'network-address'
  | 'device-connection'
  | 'tool-version'
  | 'tool-availability'
  | 'filesystem-path'

/**
 * Donanım/envanter anlık görüntüsü: VID/PID, COM portu, aygıt kimliği.
 * "VID_0B05&PID_6206", "USB\VID_...", "COM5 portu"
 */
function isHardwareInventory(text: string): boolean {
  if (/\b(?:VID|PID)[_&]?[0-9A-F]{4}\b/i.test(text)) return true
  if (/\busb\\[a-z0-9&_\\{}-]+/i.test(text)) return true
  // Aynı metinde hem port hem aygıt sözcüğü geçiyorsa envanter sayılır.
  if (/\bCOM\d+\b/i.test(text) && /(port|aygıt|cihaz|bridge|uart)/i.test(text)) {
    return true
  }
  return false
}

/** Seri port listesi: "COM5, COM7 ve COM9". */
function isSerialPortList(text: string): boolean {
  const ports = text.match(/\bCOM\d+\b/gi) ?? []
  if (new Set(ports.map((port) => port.toUpperCase())).size >= 2) return true
  if (/\btty(?:USB|ACM)\d+\b/i.test(text)) return true
  return false
}

/** Ağ adresi: IP, MAC, RSSI, SSID. */
function isNetworkAddress(text: string): boolean {
  if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text)) return true
  if (/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/i.test(text)) return true
  if (/\bRSSI\b|-?\d+\s*dBm\b/i.test(text)) return true
  // "SSID ağına bağlı" — çekimler için kök eşleşmesi.
  if (/SSID/i.test(text) && /(bağ|ağ|connected)/i.test(text)) return true
  return false
}

/** "şu anda bağlı", "takılı değil", "bağlantı yok" gibi durum bildirimleri. */
function isDeviceConnectionState(text: string): boolean {
  const state = /(şu an|halihazırda|currently)/i
  // `bağ` kökü: bağlı, bağlantılı, bağlanmış. `takılı`, `devre dışı` de sayılır.
  const connection = /(bağ|takılı|connected|attached|devre dışı|disabled)/i
  if (state.test(text) && connection.test(text)) return true

  // "bilgisayara bağlı", "USB portuna bağlı" — belirli bir bağlantı noktası
  // belirtildiğinde bu bir anlık durumdur, kalıcı bilgi değil.
  if (/(bilgisayara|portuna|porta|sisteme|makineye|host'a)\s+(?:bağlı|takılı)/i.test(text)) {
    return true
  }

  // "bağlı … bulunuyor/var/mevcut" — aygıtın takılı olduğunu bildiren cümle.
  if (/(?:bağlı|takılı)[^.]{0,40}(?:bulunuyor|bulunmaktadır|mevcut|var\b)/i.test(text)) {
    return true
  }

  return false
}

/** Kurulu araç sürümleri: "esptool 5.3.1", "Python 3.13.12". */
function isToolVersion(text: string): boolean {
  return /\b(?:esptool|pyserial|python|node|git|adb|ffmpeg)\s+v?\d+\.\d+(?:\.\d+)?/i.test(text)
}

/**
 * "Bu ortamda X aracı yok / çalıştırılamıyor" gibi yetenek bildirimleri.
 * Çekimler için kök eşleşmesi: `araç` → `aracı`, `komut` → `komutları`.
 */
function isToolAvailability(text: string): boolean {
  const absent = /(yok|yoktur|çalıştırılamıyor|kullanılamıyor|bulunmuyor|mevcut değil|desteklenmiyor)/i
  if (!absent.test(text)) return false
  // Kabuk/terminal/araç sözcüklerinden biri geçiyorsa yetenek bildirimidir.
  return /(kabuk|terminal|shell|komut|araç|arac|tool)/i.test(text)
}

/** Makineye özgü mutlak yol: "C:\Users\...", "C:\Program Files\...". */
function isFilesystemPath(text: string): boolean {
  return /\b[A-Z]:\\(?:Users|Program Files|Windows)\\/i.test(text)
}

/**
 * Metnin neden geçici olduğunu söyler; kalıcıysa `null`.
 *
 * Sıra önemli: en belirgin sinyal önce denenir.
 */
export function volatileReason(text: string): VolatileReason | null {
  if (!text) return null
  if (isHardwareInventory(text)) return 'usb-inventory'
  if (isSerialPortList(text)) return 'serial-port'
  if (isDeviceConnectionState(text)) return 'device-connection'
  if (isNetworkAddress(text)) return 'network-address'
  if (isToolVersion(text)) return 'tool-version'
  if (isToolAvailability(text)) return 'tool-availability'
  if (isFilesystemPath(text)) return 'filesystem-path'
  return null
}

/** Kısa yardımcı: metin geçici mi? */
export function isVolatileMemory(text: string): boolean {
  return volatileReason(text) !== null
}

/** Nedeni insan diline çevirir (log ve arayüz için). */
export function volatileReasonLabel(reason: VolatileReason): string {
  switch (reason) {
    case 'usb-inventory':
      return 'USB envanteri (VID/PID)'
    case 'serial-port':
      return 'seri port listesi'
    case 'network-address':
      return 'ağ adresi'
    case 'device-connection':
      return 'aygıt bağlantı durumu'
    case 'tool-version':
      return 'araç sürümü'
    case 'tool-availability':
      return 'araç kullanılabilirliği'
    case 'filesystem-path':
      return 'makineye özgü yol'
  }
}

/**
 * Geçmiş gözlemlerin modele verilirken önüne eklenen uyarı.
 *
 * Neden gerekli: anı silinemiyorsa (eski sürüm kaydı, kullanıcı verisi),
 * en azından modelin onu **güncel gerçek** sanması engellenir.
 */
export const VOLATILE_MEMORY_CAVEAT =
  'GEÇMİŞ GÖZLEM — güncel olmayabilir; kullanmadan önce ilgili araçla doğrula.'

/**
 * Eski kayıtlara geçicilik işareti ekler (göç).
 *
 * Neden ayrı ve saf: `store.load()` şifreli dosyayı okur; sınıflandırma
 * mantığını oradan ayırmak, gerçek kullanıcı verisine dokunmadan test
 * edilebilmesini sağlar.
 *
 * Kurallar:
 *  - `volatile` alanı **zaten tanımlıysa** dokunulmaz (idempotent).
 *  - Geçici metin → `volatile: true` + `volatileKind`.
 *  - Kalıcı metin → `volatile: false` (yeniden sınıflandırılmasın).
 *  - Hiçbir kayıt silinmez; yalnızca işaretlenir.
 *
 * @returns İşaretlenen (yeni geçici bulunan) kayıt sayısı.
 */
export function demoteVolatileEntries(
  entries: Array<{ text: string; volatile?: boolean; volatileKind?: string }>
): number {
  let demoted = 0
  for (const entry of entries) {
    if (entry.volatile !== undefined) continue
    const reason = volatileReason(entry.text)
    if (reason) {
      entry.volatile = true
      entry.volatileKind = reason
      demoted += 1
    } else {
      entry.volatile = false
    }
  }
  return demoted
}
