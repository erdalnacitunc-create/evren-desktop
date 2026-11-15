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
   *
   * Okuma bir ilerleme türüdür. Araç çağrısı yapıp hiçbir şey okumayan adım
   * (ör. aynı komutu tekrar denemek) hâlâ ilerlemesiz sayılır.
   */
  productiveReads?: number
  /**
   * Bu adımda yapılan **koordinasyon** işi sayısı: alt ajan başlatmak,
   * `task_wait`/`task_status` ile beklemek.
   *
   * Neden: 0.4.17 canlı koşusunda (faz 1) ana ajanın dört adımı
   * `spawn_agent` → `spawn_agent` → `task_wait` → `task_wait` idi. Bunlar
   * okuma değil, ama **gerçek iş yönetimi**: ajan arka planda çalışıyor ve
   * ana ajan onu bekliyor. Yönlendirme yine "araç çağırmayı bırak" dedi;
   * oysa yapılacak doğru şey beklemeye devam etmekti.
   */
  coordinationSignals?: number
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
   * Sert eşik: bu kadar ardışık metinsiz adımdan sonra, ilerleme olsa bile
   * yönlendirme gönderilir (sonsuz okuma/bekleme döngüsüne karşı ağ).
   *
   * 0.4.18 düzeltmesi: ham adım sayısı tek başına yeterli değildi. Canlı koşuda
   * (faz 2) ana ajan 8 adım boyunca alt ajan başlatıp bekledi — her adımda
   * gerçek koordinasyon vardı — ve sert eşik "metinsiz" sayıp yönlendirme
   * gönderdi. Artık pencere içinde ardışık ilerleme yoksa devreye girer.
   */
  hardThreshold?: number
  /**
   * Sert eşik için "taze ilerleme" penceresi: son bu kadar adımda okuma veya
   * koordinasyon varsa sert eşik ertelenir.
   */
  freshProgressWindow?: number
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

/** Alt ajan yönetimi sayılan araçlar. */
const COORD_TOOLS = new Set(['spawn_agent', 'task_wait', 'task_status', 'task_list'])

/**
 * Bir araç çağrısı gerçek iş yönetimi mi?
 *
 * - `spawn_agent` başarılıysa: iş başlatıldı → ilerleme.
 * - `task_wait`/`task_status`/`task_list` anlamlı yanıt verdiyse (sonuç ya da
 *   "hâlâ çalışıyor"): ajan durumu gözlendi → ilerleme.
 *
 * Eşik 40 karakter: "Görev bulunamadı: sub-…" gibi kısa hatalar ilerleme
 * sayılmaz, model yönlendirilmeye devam eder.
 */
export function isCoordinationProgress(
  toolName: string,
  ok: boolean,
  contentLength: number
): boolean {
  if (!ok || contentLength < 40) return false
  return COORD_TOOLS.has(toolName)
}

/**
 * Yönlendirme gönderilmeli mi?
 *
 * Bir adım "ilerlemesiz" sayılır eğer:
 *  - o adımda metin üretilmedi, ve
 *  - en az bir araç çağrıldı, ve
 *  - **hiçbir okuma yapılmadı**, ve
 *  - **hiçbir koordinasyon işi yapılmadı** (alt ajan başlatma/bekleme).
 *
 * Güvenlik ağı: `hardThreshold` (varsayılan 8) ardışık metinsiz adımda bunlar
 * olsa bile yönlendirme gönderilir; aksi hâlde model sonsuza kadar okuyabilir
 * veya bekleyebilir.
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
  const hardThreshold = Math.max(threshold, Math.round(options.hardThreshold ?? 12))
  const freshWindow = Math.max(2, Math.round(options.freshProgressWindow ?? 6))

  if (nudgesSent >= maxNudges) return false
  if (history.length < threshold) return false

  const noText = (step: StepObservation): boolean =>
    step.tools.length > 0 && step.contentLength === 0

  /** İlerleme var mı: okuma veya koordinasyon. */
  const hasProgress = (step: StepObservation): boolean =>
    (step.productiveReads ?? 0) > 0 || (step.coordinationSignals ?? 0) > 0

  // 1) Yumuşak eşik: metinsiz VE ilerlemesiz adımlar.
  const softWindow = history.slice(-threshold)
  if (softWindow.every((step) => noText(step) && !hasProgress(step))) {
    return true
  }

  // 2) Sert eşik: uzun süredir metin yok ve **son adımlarda da ilerleme yok**.
  //    Taze ilerleme varsa (okuma/koordinasyon sürüyor) bekle: uzun keşif
  //    meşru olabilir. Sonsuz döngü zaten araç bütçesiyle sınırlı.
  if (history.length >= hardThreshold) {
    const hardWindow = history.slice(-hardThreshold)
    const fresh = history.slice(-freshWindow)
    if (hardWindow.every(noText) && !fresh.some(hasProgress)) return true
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
    if ((step.coordinationSignals ?? 0) > 0) break
    streak += 1
  }
  return streak
}
