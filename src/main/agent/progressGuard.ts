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
}

/**
 * Yönlendirme gönderilmeli mi?
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

  if (nudgesSent >= maxNudges) return false
  if (history.length < threshold) return false

  const window = history.slice(-threshold)
  return window.every(
    (step) => step.tools.length > 0 && step.contentLength === 0
  )
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
 */
export function stalledStreak(history: StepObservation[]): number {
  let streak = 0
  for (let index = history.length - 1; index >= 0; index--) {
    const step = history[index]
    if (!step) break
    if (step.tools.length === 0 || step.contentLength > 0) break
    streak += 1
  }
  return streak
}
