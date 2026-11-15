/**
 * İlerlemesiz döngü koruması.
 *
 * ## Neden
 *
 * Adım sınırı kaldırıldıktan sonra (OpenCode `agent.steps` semantiği) yeni bir
 * davranış ortaya çıktı: model bazen **hiçbir metin üretmeden** araçları
 * arka arkaya çağırıyor. Canlı koşuda gözlendi (19 dk, 30 araç):
 *
 *   write_file scan_usb.ps1  →  run_command
 *   write_file scan_usb2.ps1 →  run_command
 *   … scan_usb6.ps1'e kadar
 *
 * Sonunda rapor yazıldı, yani felaket değil — ama işin 2-3 katı sürdü. Sert
 * adım sınırı yanlış çözüm: eski "0 karakter + max-steps" hatasını geri
 * getirir. Doğrusu, birkaç turdur metin üretmeyen modele **hafif bir
 * yönlendirme** vermek: "bulguları şimdi raporla".
 *
 * ## Ölçüt
 *
 * Bir adım "ilerlemesiz" sayılır eğlence:
 *  - o adımda üretilen metin boş (yalnızca araç çağrısı), ve
 *  - en az bir araç çağrıldı.
 *
 * Son N adımın tamamı böyleyse yönlendirme gönderilir. N=4 seçildi: tek
 * seferlik inceleme turları (2-3 adım) tetiklemez, gerçek döngüleri yakalar.
 *
 * Yönlendirme **tekrar edilebilir** ama sınırlıdır (varsayılan 2): model
 * uymazsa ikinci kez daha kesin bir dille söylenir, sonra karışılmaz.
 */

/** Tek bir adımın gözlemi. */
export interface StepObservation {
  /** O adımda üretilen metnin uzunluğu (boşluklar dahil). */
  contentLength: number
  /** Çağrılan araç adları. */
  tools: string[]
  /**
   * Bu adımda **başarıyla** yapılan okuma sayısı.
   *
   * Neden: "metinsiz adım = ilerlemesiz adım" varsayımı yanlıştı. 0.4.16 canlı
   * koşusunda gemma-4-31b dört adımda dosya okudu (kullanıcı içerik istemişti),
   * hiç metin yazmadı ve yönlendirme "araç çağırmayı bırak, raporla" dedi.
   * Sonuç: 1886 kr'lik yarım rapor ve **sıfır alt ajan** — oysa istem açıkça
   * "maksimum seviyede alt ajan kullan" diyordu.
   *
   * Okuma bir ilerleme türüdür. Araç çağrısı yapıp hiçbir şey okumayan adım
   * (ör. aynı komutu tekrar denemek) hâlâ ilerlemesiz sayılır.
   */
  productiveReads?: number
}

export const PROGRESS_NUDGE = `DURUM: Birkaç turdur yalnızca araç çağırıyorsun, kullanıcıya metin dönmedin.

Elde ettiğin bulgular büyük olasılıkla yeterli. Şimdi:
- Yeni araç çağırmayı bırak.
- Topladığın bulguları kullanıcıya doğrudan, düzenli biçimde raporla.
- Eksik kalan bir nokta varsa raporda "doğrulanamadı" diye belirt; yeni tarama başlatma.

Yalnızca gerçekten zorunlu, tek bir son doğrulama kaldıysa araç çağırabilirsin.`

export const PROGRESS_NUDGE_FINAL = `DURUM: Hâlâ yalnızca araç çağırıyorsun. Araç çağırmayı ŞİMDİ bırak ve yanıtı metin olarak yaz.

Elindeki bilgiyle yetin. Eksik bilgiyi "doğrulanamadı" olarak işaretle. Bir sonraki mesajın araç çağrısı içerirse çalıştırılmayacak.`

export interface ProgressGuardOptions {
  /** Kaç ardışık ilerlemesiz adımdan sonra yönlendirme gönderilsin. */
  threshold?: number
  /** Bir çalıştırmada en çok kaç yönlendirme gönderilsin. */
  maxNudges?: number
  /**
   * Sert eşik: okuma yapılsa bile bu kadar ardışık metinsiz adımdan sonra
   * yönlendirme gönderilir. Sonsuz okuma döngüsüne karşı güvenlik ağı.
   */
  hardThreshold?: number
}

/** Okuma sayılan araçlar: içerik elde eden çağrılar. */
const READ_TOOLS = new Set([
  'read_file',
  'grep',
  'glob',
  'list_files',
  'code_search',
  'repo_map',
  'webfetch',
  'websearch',
  'run_command',
  'execute',
  'usb_devices'
])

/** Bir araç çağrısı içerik ürettiyse okuma sayılır. */
export function isProductiveRead(toolName: string, ok: boolean, contentLength: number): boolean {
  if (!ok || contentLength < 40) return false
  return READ_TOOLS.has(toolName)
}

/**
 * Yönlendirme gönderilmeli mi?
 *
 * Bir adım "ilerlemesiz" sayılır eğer:
 *  - o adımda metin üretilmedi, ve
 *  - en az bir araç çağrıldı, ve
 *  - **hiçbir okuma yapılmadı** (0.4.17: okuma da ilerlemedir).
 *
 * Güvenlik ağı: `hardThreshold` (varsayılan 8) ardışık metinsiz adımda okuma
 * olsa bile yönlendirme gönderilir; aksi hâlde model sonsuza kadar okuyabilir.
 *
 * @param history  Bu çalıştırmadaki adımların gözlemleri (eskiden yeniye).
 * @param nudgesSent Bu çalıştırmada şimdiye kadar gönderilen yönlendirme sayısı.
 */
export function shouldNudgeProgress(
  history: StepObservation[],
  nudgesSent = 0,
  options: ProgressGuardOptions = {}
): boolean {
  const threshold = Math.max(2, Math.round(options.threshold ?? 4))
  const maxNudges = Math.max(0, Math.round(options.maxNudges ?? 2))
  const hardThreshold = Math.max(threshold, Math.round(options.hardThreshold ?? 8))

  if (nudgesSent >= maxNudges) return false
  if (history.length < threshold) return false

  const noText = (step: StepObservation): boolean =>
    step.tools.length > 0 && step.contentLength === 0

  // 1) Yumuşak eşik: metinsiz VE okumasız adımlar.
  const softWindow = history.slice(-threshold)
  if (
    softWindow.every(
      (step) => noText(step) && (step.productiveReads ?? 0) === 0
    )
  ) {
    return true
  }

  // 2) Sert eşik: okuma olsa da uzun süre metin yok.
  if (history.length >= hardThreshold) {
    const hardWindow = history.slice(-hardThreshold)
    if (hardWindow.every(noText)) return true
  }

  return false
}

/**
 * Gönderilecek yönlendirme metnini seçer.
 * İlk yönlendirme yumuşak, ikincisi kesindir.
 */
export function progressNudgeMessage(nudgesSent: number): string {
  return nudgesSent === 0 ? PROGRESS_NUDGE : PROGRESS_NUDGE_FINAL
}

/**
 * Ardışık ilerlemesiz adım sayısı (tanılama/log için).
 *
 * İlerlemesiz: metin yok, araç var, **okuma yok**.
 */
export function stalledStreak(history: StepObservation[]): number {
  let streak = 0
  for (let index = history.length - 1; index >= 0; index--) {
    const step = history[index]
    if (!step) break
    if (step.tools.length === 0 || step.contentLength > 0) break
    if ((step.productiveReads ?? 0) > 0) break
    streak += 1
  }
  return streak
}
