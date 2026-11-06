/**
 * Panel yerleşimi — boyut sınırlama ve kalıcılık yardımcıları.
 *
 * ## Neden ayrı ve saf
 *
 * Kenar panellerinin (sohbet listesi, inceleme, dosyalar, görevler, git,
 * terminal) genişliği kullanıcının tercihidir; oturumlar arasında korunmalı.
 * Sınırlama/kalıcılık mantığını React'ten ayırmak, davranışı tarayıcı
 * açmadan test etmeyi sağlar (`panel-layout-test`).
 *
 * ## Kurallar
 *
 * - Genişlik her zaman `[min, max]` aralığına kırpılır; bozuk değer
 *   varsayılana döner.
 * - Pencere çok küçülürse `max` gerçek pencere genişliğine göre daralır,
 *   böylece sohbet alanı sıfırlanmaz.
 * - `localStorage` erişimi başarısız olursa sessizce varsayılan kullanılır
 *   (gizli mod / depolama reddi).
 */

/** Panel kimliği → varsayılan/sınır değerleri. */
export interface PanelSpec {
  defaultSize: number
  minSize: number
  /** Mutlak üst sınır. Pencere daha küçükse `available` ile daraltılır. */
  maxSize: number
}

export const PANEL_SPECS = {
  /** Sol sohbet listesi. */
  sessions: { defaultSize: 290, minSize: 180, maxSize: 520 },
  /** Sağ inceleme paneli. */
  review: { defaultSize: 440, minSize: 280, maxSize: 900 },
  /** Sağ çalışma alanı (dosyalar). */
  workspace: { defaultSize: 480, minSize: 280, maxSize: 900 },
  /** Sağ görevler paneli. */
  tasks: { defaultSize: 360, minSize: 240, maxSize: 720 },
  /** Sağ git paneli. */
  git: { defaultSize: 480, minSize: 280, maxSize: 900 },
  /** Alt terminal. */
  terminal: { defaultSize: 260, minSize: 140, maxSize: 640 }
} as const satisfies Record<string, PanelSpec>

export type PanelId = keyof typeof PANEL_SPECS

/**
 * Boyutu geçerli aralığa kırpar.
 *
 * @param size      İstenen boyut (px).
 * @param spec      Panel sınırları.
 * @param available Panele ayrılabilecek gerçek alan (px). Verilmezse yalnız
 *                  `spec` sınırları uygulanır.
 */
export function clampPanelSize(
  size: number,
  spec: PanelSpec,
  available?: number
): number {
  const fallback = spec.defaultSize
  const requested = Number.isFinite(size) ? size : fallback
  let max = spec.maxSize
  if (Number.isFinite(available) && (available as number) > 0) {
    // `available` zaten sohbet kolonuna yer bırakacak şekilde hesaplanmış
    // gelir (`clampForViewport`). Burada ikinci bir yüzde uygulamak paneli
    // gereksiz yere kilitliyordu (canlı testte sürükleme tepkisiz görünüyordu).
    max = Math.min(max, Math.max(spec.minSize, Math.round(available as number)))
  }
  const min = Math.min(spec.minSize, max)
  return Math.round(Math.min(max, Math.max(min, requested)))
}

/**
 * Bir sonraki boyutu hesaplar (sürükleme sırasında).
 *
 * @param originSize Sürükleme başlarken panelin boyutu.
 * @param delta      İşaretçinin başlangıçtan bu yana kat ettiği mesafe (px).
 * @param edge       Tutamağın panelin hangi kenarında olduğu:
 *                   `start` = sol/üst (sağa/aşağı sürüklemek büyütür),
 *                   `end`   = sağ/alt (sola/yukarı sürüklemek büyütür).
 */
export function resizeFromDrag(
  originSize: number,
  delta: number,
  edge: 'start' | 'end',
  spec: PanelSpec,
  available?: number
): number {
  const signed = edge === 'start' ? delta : -delta
  return clampPanelSize(originSize + signed, spec, available)
}

/**
 * Panel boyutunu pencere genişliğine göre sınırlar.
 *
 * Neden: kullanıcı sohbet listesini ve bir yan paneli birlikte genişletirse
 * sohbet kolonu okunamaz hâle geliyordu (canlı testte toolbar taşıp yanlış
 * öğeye tıklanıyordu). Her panel, pencerenin en fazla belirli bir payını
 * alabilir; kalan alan sohbete kalır.
 *
 * @param size       İstenen boyut.
 * @param spec       Panel sınırları.
 * @param chrome     Pencerede panel dışındaki sabit alan (diğer paneller,
 *                   tutamaçlar). Verilmezse 0.
 * @param share      Panelin pencereden alabileceği en büyük pay (0–1).
 * @param viewport   Pencere genişliği/yüksekliği (test için enjekte edilir).
 */
export function clampToViewport(
  size: number,
  spec: PanelSpec,
  chrome: number,
  share: number,
  viewport: number
): number {
  if (!Number.isFinite(viewport) || viewport <= 0) return clampPanelSize(size, spec)
  const available = Math.max(spec.minSize, Math.round(viewport * share) - chrome)
  return clampPanelSize(size, spec, available)
}

/** Dar pencerede sohbet için en az bu kadar alan bırakılır.
 *  420 px: besteci kutusu (düğmeler + gönder) tek satırda rahat sığar. */
export const MIN_CHAT_WIDTH = 420

/**
 * Aynı anda açık panellerin paylarını gözeterek boyutu sınırlar.
 *
 * @param viewport Pencere genişliği.
 * @param chrome   Diğer panellerin toplam genişliği + tutamaçlar.
 */
export function clampForViewport(
  size: number,
  spec: PanelSpec,
  viewport: number,
  chrome = 0
): number {
  if (!Number.isFinite(viewport) || viewport <= 0) return clampPanelSize(size, spec)
  const allowance = Math.max(spec.minSize, viewport - chrome - MIN_CHAT_WIDTH)
  return clampPanelSize(size, spec, allowance)
}

/** Klavye ile boyut değişimi (erişilebilirlik). */
export function resizeFromKeyboard(
  currentSize: number,
  key: string,
  edge: 'start' | 'end',
  spec: PanelSpec,
  available?: number,
  step = 16
): number | null {
  const big = step * 4
  let direction = 0
  if (key === 'ArrowLeft') direction = -1
  else if (key === 'ArrowRight') direction = 1
  else if (key === 'ArrowUp') direction = -1
  else if (key === 'ArrowDown') direction = 1
  else return null
  const amount = direction * step
  const signed = edge === 'start' ? amount : -amount
  return clampPanelSize(currentSize + signed, spec, available)
}

/** `localStorage` anahtarı — sürüm önekli, çakışmasız. */
export function storageKey(id: PanelId): string {
  return `evren.panel.v1.${id}`
}

export function collapsedKey(id: PanelId): string {
  return `evren.panel.v1.${id}.collapsed`
}

/** Depodan okur; geçersizse `null`. */
export function readStoredSize(id: PanelId, spec: PanelSpec): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey(id))
    if (raw === null) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return clampPanelSize(parsed, spec)
  } catch {
    return null
  }
}

export function writeStoredSize(id: PanelId, size: number): void {
  try {
    window.localStorage.setItem(storageKey(id), String(Math.round(size)))
  } catch {
    // depolama yoksa sessizce yoksay
  }
}

export function readStoredCollapsed(id: PanelId): boolean {
  try {
    return window.localStorage.getItem(collapsedKey(id)) === '1'
  } catch {
    return false
  }
}

export function writeStoredCollapsed(id: PanelId, collapsed: boolean): void {
  try {
    window.localStorage.setItem(collapsedKey(id), collapsed ? '1' : '0')
  } catch {
    // yoksay
  }
}
