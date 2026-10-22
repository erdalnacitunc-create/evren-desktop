import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

let status: UpdateStatus = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  canCheck: false
}
let timer: NodeJS.Timeout | null = null
let initialized = false

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('update:status', status)
  }
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch, currentVersion: app.getVersion() }
  broadcast()
}

function notesToString(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes.slice(0, 8000)
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (entry && typeof entry === 'object' && 'note' in entry) {
          return String((entry as { note?: unknown }).note ?? '')
        }
        return String(entry)
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000)
  }
  return undefined
}

export function updaterStatus(): UpdateStatus {
  return { ...status }
}

export function initUpdater(): void {
  if (initialized) return
  initialized = true

  if (!app.isPackaged || process.env['EVREN_UPDATE_DISABLE'] === '1') {
    setStatus({
      phase: 'disabled',
      canCheck: false,
      error: app.isPackaged
        ? 'Güncellemeler bu yapıda devre dışı.'
        : 'Güncellemeler yalnızca paketlenmiş sürümde çalışır.'
    })
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = true
  autoUpdater.allowDowngrade = false

  setStatus({ phase: 'idle', canCheck: true, error: undefined })

  autoUpdater.on('checking-for-update', () => {
    setStatus({ phase: 'checking', canCheck: true, error: undefined, percent: undefined })
  })
  autoUpdater.on('update-available', (info) => {
    setStatus({
      phase: 'available',
      version: info.version,
      releaseNotes: notesToString(info.releaseNotes),
      canCheck: true,
      error: undefined
    })
  })
  autoUpdater.on('update-not-available', () => {
    setStatus({
      phase: 'not-available',
      canCheck: true,
      error: undefined,
      percent: undefined
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      canCheck: false,
      error: undefined
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({
      phase: 'downloaded',
      version: info.version,
      releaseNotes: notesToString(info.releaseNotes),
      percent: 100,
      canCheck: false,
      error: undefined
    })
  })
  autoUpdater.on('error', (error) => {
    setStatus({
      phase: 'error',
      canCheck: true,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 600)
    })
  })

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      setStatus({
        phase: 'error',
        canCheck: true,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 600)
      })
    })
  }

  setTimeout(check, 15_000)
  timer = setInterval(check, 6 * 60 * 60_000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged || process.env['EVREN_UPDATE_DISABLE'] === '1') {
    setStatus({ phase: 'disabled', canCheck: false })
    return updaterStatus()
  }
  if (status.phase === 'checking' || status.phase === 'downloading') return updaterStatus()
  setStatus({ phase: 'checking', canCheck: true, error: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setStatus({
      phase: 'error',
      canCheck: true,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 600)
    })
  }
  return updaterStatus()
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.phase !== 'available') return updaterStatus()
  setStatus({ phase: 'downloading', canCheck: false, percent: 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setStatus({
      phase: 'error',
      canCheck: true,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 600)
    })
  }
  return updaterStatus()
}

export function installUpdate(): void {
  if (status.phase !== 'downloaded') return
  autoUpdater.quitAndInstall(false, true)
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}
