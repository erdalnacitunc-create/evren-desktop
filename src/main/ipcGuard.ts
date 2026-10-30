import { app } from 'electron'
import { resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from './logger'

/**
 * Renderer kaynaklarının bulunabileceği kökler.
 * - Paketlenmiş uygulama: <app.asar>/out/renderer
 * - Geliştirme derlemesi: <proje>/out/renderer
 */
export function allowedRendererRoots(): string[] {
  const roots = new Set<string>()
  roots.add(resolve(__dirname, '..', 'renderer'))
  try {
    roots.add(resolve(app.getAppPath(), 'out', 'renderer'))
  } catch {
    // app hazır değilse yalnızca __dirname tabanlı kök kullanılır
  }
  return [...roots]
}

function normalizePath(value: string): string {
  return resolve(value).toLowerCase()
}

function isInsideRenderer(target: string): boolean {
  const file = normalizePath(target)
  for (const root of allowedRendererRoots()) {
    const normalized = normalizePath(root)
    if (file === normalized) return true
    if (file.startsWith(normalized.endsWith(sep) ? normalized : `${normalized}${sep}`)) {
      return true
    }
  }
  return false
}

/** Geliştirme sunucusunun izinli origin'i (yalnızca ELECTRON_RENDERER_URL varsa). */
export function allowedDevOrigin(): string | null {
  const raw = process.env['ELECTRON_RENDERER_URL']
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

export interface SenderFrameLike {
  url: string
  parent?: unknown
}

export interface SenderLike {
  isDestroyed?: () => boolean
  mainFrame?: SenderFrameLike
}

export interface IpcSenderEventLike {
  senderFrame?: SenderFrameLike | null
  sender?: SenderLike
}

export type SenderVerdict =
  | { ok: true; origin: string }
  | { ok: false; reason: string }

/**
 * Bir IPC çağrısının güvenilir renderer'dan gelip gelmediğini değerlendirir.
 * Saf fonksiyon: Electron'a bağımlı değildir, bu yüzden test edilebilir.
 */
export function evaluateSender(
  event: IpcSenderEventLike,
  channel: string
): SenderVerdict {
  const frame = event.senderFrame
  if (!frame || typeof frame.url !== 'string' || !frame.url) {
    return { ok: false, reason: `${channel}: gönderici çerçeve yok` }
  }

  const sender = event.sender
  if (sender?.isDestroyed?.() === true) {
    return { ok: false, reason: `${channel}: gönderici yok edilmiş` }
  }

  // Alt çerçeveler (iframe, srcdoc, sandbox önizleme) IPC çağıramaz.
  if (frame.parent !== undefined && frame.parent !== null) {
    return { ok: false, reason: `${channel}: alt çerçeveden çağrı` }
  }
  if (sender?.mainFrame && sender.mainFrame !== frame) {
    return { ok: false, reason: `${channel}: ana çerçeve değil` }
  }

  let parsed: URL
  try {
    parsed = new URL(frame.url)
  } catch {
    return { ok: false, reason: `${channel}: geçersiz çerçeve URL'i` }
  }

  if (parsed.protocol === 'file:') {
    let path: string
    try {
      path = fileURLToPath(parsed)
    } catch {
      return { ok: false, reason: `${channel}: çözülemeyen dosya yolu` }
    }
    if (!isInsideRenderer(path)) {
      return { ok: false, reason: `${channel}: izin verilmeyen dosya yolu` }
    }
    return { ok: true, origin: 'file://renderer' }
  }

  const devOrigin = allowedDevOrigin()
  if (devOrigin && parsed.origin === devOrigin) {
    return { ok: true, origin: parsed.origin }
  }

  return { ok: false, reason: `${channel}: izin verilmeyen origin ${parsed.origin}` }
}

/** Denetlenen IPC çağrıları için tek giriş noktası. */
export function assertTrustedSender(
  event: IpcSenderEventLike,
  channel: string
): void {
  const verdict = evaluateSender(event, channel)
  if (!verdict.ok) {
    createLogger('ipc').warn(`Reddedildi — ${verdict.reason}`)
    throw new Error(`IPC reddedildi — ${verdict.reason}`)
  }
}
