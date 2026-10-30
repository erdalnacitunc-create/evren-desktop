import { BrowserWindow } from 'electron'
import type { TerminalStatus } from '../shared/types'
import { getWorkspaceRoot } from './workspace'

/**
 * Gerçek PTY terminal (node-pty).
 *
 * `@lydell/node-pty` platforma özel önceden derlenmiş ikili dosyalar kullanır.
 * Yüklenemezse (desteklenmeyen mimari, eksik prebuild) çağıran taraf boru
 * (pipe) tabanlı yedeğe düşer; burada hata fırlatılmaz.
 */

interface PtyProcessLike {
  readonly pid: number
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

interface PtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      cols?: number
      rows?: number
      cwd?: string
      env?: Record<string, string | undefined>
      name?: string
      useConpty?: boolean
    }
  ): PtyProcessLike
}

let loaded: PtyModule | null | undefined
let loadError: string | null = null
let proc: PtyProcessLike | null = null
let currentCwd = ''
let currentShell = ''
let statusError: string | undefined
let ptyUnavailable = false

/** node-pty'yi tembel yükler. Başarısızsa null döner ve nedeni saklar. */
async function loadPty(): Promise<PtyModule | null> {
  if (loaded !== undefined) return loaded
  try {
    const mod = (await import('@lydell/node-pty')) as unknown as PtyModule & {
      default?: PtyModule
    }
    const candidate = typeof mod.spawn === 'function' ? mod : mod.default
    if (!candidate || typeof candidate.spawn !== 'function') {
      throw new Error('node-pty spawn bulunamadı')
    }
    loaded = candidate
    return loaded
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error)
    loaded = null
    ptyUnavailable = true
    return null
  }
}

export function ptyAvailable(): boolean {
  return !ptyUnavailable
}

export function ptyLoadError(): string | null {
  return loadError
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function shellCommand(): { file: string; args: string[]; label: string } {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile'],
      label: 'PowerShell'
    }
  }
  const shell = process.env['SHELL'] || '/bin/bash'
  return { file: shell, args: ['-l'], label: shell.split('/').pop() || 'Shell' }
}

function environment(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') result[key] = value
  }
  result['TERM'] = 'xterm-256color'
  result['COLORTERM'] = 'truecolor'
  result['PYTHONIOENCODING'] = 'utf-8'
  return result
}

export function ptyStatus(): TerminalStatus {
  return {
    running: !!proc,
    cwd: currentCwd || null,
    shell: proc ? currentShell : null,
    error: statusError ?? (ptyUnavailable ? loadError ?? 'PTY kullanılamıyor' : undefined),
    mode: proc ? 'pty' : ptyUnavailable ? 'pipe' : 'pty'
  }
}

export interface StartPtyOptions {
  cwd?: string
  cols?: number
  rows?: number
  /** Oturum zaten aynı klasörde çalışıyorsa yeniden başlatmaz. */
  reuse?: boolean
}

export async function startPty(options: StartPtyOptions = {}): Promise<TerminalStatus> {
  const workspace = options.cwd ?? (await getWorkspaceRoot())
  const cwd = workspace || process.env['USERPROFILE'] || process.env['HOME'] || process.cwd()

  if (proc && options.reuse !== false && currentCwd === cwd) return ptyStatus()
  stopPty()

  const pty = await loadPty()
  if (!pty) {
    statusError = loadError ?? 'PTY kullanılamıyor'
    return ptyStatus()
  }

  const shell = shellCommand()
  const cols = Math.max(20, Math.min(400, Math.round(options.cols ?? 100)))
  const rows = Math.max(5, Math.min(200, Math.round(options.rows ?? 30)))

  try {
    proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: environment()
    })
    currentCwd = cwd
    currentShell = shell.label
    statusError = undefined
  } catch (error) {
    statusError = error instanceof Error ? error.message : String(error)
    proc = null
    return ptyStatus()
  }

  const active = proc
  active.onData((data) => {
    if (!data) return
    broadcast('terminal:raw', { data })
  })
  active.onExit(({ exitCode, signal }) => {
    if (proc === active) {
      proc = null
      currentShell = ''
    }
    broadcast('terminal:exit', { code: exitCode, signal: signal ?? null })
  })

  // Windows PowerShell 5.1 varsayılan olarak UTF-16 boru kullanır; Türkçe
  // karakterlerin bozulmaması için çıktıyı UTF-8'e ayarla.
  if (process.platform === 'win32') {
    try {
      active.write(
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8\r'
      )
    } catch {
      // kabuk hazır değilse yoksay
    }
  }

  return ptyStatus()
}

export function writePty(data: string): boolean {
  if (!proc) return false
  const text = String(data ?? '')
  if (!text) return false
  try {
    proc.write(text)
    return true
  } catch (error) {
    statusError = error instanceof Error ? error.message : String(error)
    return false
  }
}

export function resizePty(cols: number, rows: number): boolean {
  if (!proc) return false
  const safeCols = Math.max(20, Math.min(400, Math.round(cols) || 100))
  const safeRows = Math.max(5, Math.min(200, Math.round(rows) || 30))
  try {
    proc.resize(safeCols, safeRows)
    return true
  } catch {
    return false
  }
}

export function stopPty(): void {
  if (!proc) {
    currentShell = ''
    return
  }
  const active = proc
  proc = null
  currentShell = ''
  try {
    active.kill()
  } catch {
    // yut
  }
}

/** Çalışan kabuğa Ctrl+C (SIGINT) gönderir; oturumu kapatmaz. */
export function interruptPty(): boolean {
  if (!proc) return false
  if (process.platform === 'win32') {
    // ConPTY'de Ctrl+C, ETX karakteri olarak gönderilir.
    return writePty('\u0003')
  }
  try {
    proc.write('\u0003')
    return true
  } catch {
    return false
  }
}
