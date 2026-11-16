import type { UpdateStatus } from '../../../shared/types'

/**
 * Üst çubuk güncelleme düğmesinin durum türetimi (saf).
 *
 * Neden ayrı: butonun görsel sözleşmesi test edilebilir olmalı. opencode ve
 * Antigravity deseninde düğme **tek tıkla** akışı ilerletir; hangi fazda ne
 * yapacağı ve hangi rengi alacağı tahmin edilmemeli.
 */

export type UpdateIntent =
  /** Hiçbir şey yapma (paketlenmemiş yapı). */
  | 'hidden'
  /** Güncellemeyi denetle. */
  | 'check'
  /** Yeni sürümü indir. */
  | 'download'
  /** İndirileni kur ve yeniden başlat. */
  | 'install'
  /** İşlem sürüyor; tıklama yok. */
  | 'busy'
  /** Hata: yeniden denemek için denetle. */
  | 'retry'

export type UpdateTone = 'idle' | 'available' | 'ready' | 'error' | 'busy'

export interface UpdateButtonState {
  intent: UpdateIntent
  tone: UpdateTone
  /** Düğme görünür mü. */
  visible: boolean
  /** Rozet noktası gösterilsin mi (yeni sürüm bildirimi). */
  showDot: boolean
  /** Devre dışı mı. */
  disabled: boolean
}

/**
 * Durumdan düğme davranışını türetir.
 *
 * Kural: `hidden` yalnızca paketlenmemiş yapıda. Diğer her fazda düğme
 * görünür — kullanıcı güncelleme akışını Ayarlar'a girmeden yürütebilmeli.
 */
export function updateButtonState(status: UpdateStatus | null, busy = false): UpdateButtonState {
  if (!status) {
    return { intent: 'busy', tone: 'busy', visible: false, showDot: false, disabled: true }
  }

  switch (status.phase) {
    case 'disabled':
      return { intent: 'hidden', tone: 'idle', visible: false, showDot: false, disabled: true }

    case 'checking':
      return { intent: 'busy', tone: 'busy', visible: true, showDot: false, disabled: true }

    case 'downloading':
      return { intent: 'busy', tone: 'busy', visible: true, showDot: false, disabled: true }

    case 'available':
      return {
        intent: 'download',
        tone: 'available',
        visible: true,
        showDot: true,
        // `canCheck` yükleme iznini de kapsar; indirilemiyorsa tıklama kapalı.
        disabled: busy || !status.canCheck
      }

    case 'downloaded':
      return { intent: 'install', tone: 'ready', visible: true, showDot: false, disabled: busy }

    case 'error':
      return {
        intent: 'retry',
        tone: 'error',
        visible: true,
        showDot: false,
        disabled: busy || !status.canCheck
      }

    case 'idle':
    case 'not-available':
      return {
        intent: 'check',
        tone: 'idle',
        visible: true,
        showDot: false,
        disabled: busy || !status.canCheck
      }

    default:
      return { intent: 'check', tone: 'idle', visible: true, showDot: false, disabled: busy }
  }
}

/**
 * Faz → i18n anahtarı.
 *
 * Eski sürümde bu eşleme `UpdatePanel` içinde gömülüydü; düğme ve panel aynı
 * metni göstermeli, bu yüzden ortak yerde tutulur.
 */
export const UPDATE_PHASE_KEYS = {
  disabled: 'update.phase.disabled',
  idle: 'update.phase.idle',
  checking: 'update.phase.checking',
  available: 'update.phase.available',
  'not-available': 'update.phase.notAvailable',
  downloading: 'update.phase.downloading',
  downloaded: 'update.phase.downloaded',
  error: 'update.phase.error'
} as const

/** İndirme yüzdesini 0-100 tam sayıya sıkıştırır. */
export function downloadPercent(percent: number | undefined): number {
  const value = typeof percent === 'number' && Number.isFinite(percent) ? percent : 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
