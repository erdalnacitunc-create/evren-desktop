import { app, screen, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

const DEFAULT_STATE: WindowState = { width: 1180, height: 820 }

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function isVisibleOnSomeDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      state.x! < area.x + area.width &&
      state.x! + state.width > area.x &&
      state.y! < area.y + area.height &&
      state.y! + state.height > area.y
    )
  })
}

export async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = await fs.readFile(stateFile(), 'utf8')
    const parsed = JSON.parse(raw) as WindowState
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return DEFAULT_STATE
    }
    if (!isVisibleOnSomeDisplay(parsed)) {
      return { width: parsed.width, height: parsed.height, maximized: parsed.maximized }
    }
    return parsed
  } catch {
    return DEFAULT_STATE
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const save = async (): Promise<void> => {
    if (win.isDestroyed()) return
    const bounds = win.getNormalBounds()
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized()
    }
    try {
      await fs.writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8')
    } catch {
      // sessizce gec
    }
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void save(), 400)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    void save()
  })
}
