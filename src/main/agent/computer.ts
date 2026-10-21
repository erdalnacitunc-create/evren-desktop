import { app } from 'electron'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

interface HelperResult {
  ok: boolean
  error?: string
  path?: string
  width?: number
  height?: number
  originX?: number
  originY?: number
  x?: number
  y?: number
}

function helperPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'computer-helper.ps1')
  }
  return join(app.getAppPath(), 'resources', 'computer-helper.ps1')
}

export async function runComputerCommand(
  command: Record<string, unknown>
): Promise<HelperResult> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Sta',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath(),
      JSON.stringify(command)
    ],
    { timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  )

  const text = stdout.trim()
  if (!text) throw new Error('Bilgisayar yardımcısı boş yanıt döndü.')
  return JSON.parse(text) as HelperResult
}

export function toSendKeys(input: string): string {
  const special: Record<string, string> = {
    enter: '{ENTER}',
    return: '{ENTER}',
    tab: '{TAB}',
    esc: '{ESC}',
    escape: '{ESC}',
    space: ' ',
    backspace: '{BACKSPACE}',
    delete: '{DELETE}',
    del: '{DELETE}',
    up: '{UP}',
    down: '{DOWN}',
    left: '{LEFT}',
    right: '{RIGHT}',
    home: '{HOME}',
    end: '{END}',
    pageup: '{PGUP}',
    pagedown: '{PGDN}',
    insert: '{INSERT}',
    f1: '{F1}',
    f2: '{F2}',
    f3: '{F3}',
    f4: '{F4}',
    f5: '{F5}',
    f6: '{F6}',
    f7: '{F7}',
    f8: '{F8}',
    f9: '{F9}',
    f10: '{F10}',
    f11: '{F11}',
    f12: '{F12}'
  }

  const parts = input
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''

  const key = parts.pop() as string
  let prefix = ''
  for (const part of parts) {
    if (/^(ctrl|control)$/i.test(part)) prefix += '^'
    else if (/^alt$/i.test(part)) prefix += '%'
    else if (/^shift$/i.test(part)) prefix += '+'
  }

  const mapped = special[key.toLowerCase()] ?? key
  return prefix + mapped
}

export async function captureScreen(): Promise<{
  dataUrl: string
  width: number
  height: number
}> {
  const result = await runComputerCommand({ cmd: 'screen' })
  if (!result.ok || !result.path) {
    throw new Error(result.error ?? 'Ekran görüntüsü alınamadı.')
  }
  const buffer = await fs.readFile(result.path)
  try {
    await fs.unlink(result.path)
  } catch {
    // yut
  }
  return {
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    width: result.width ?? 0,
    height: result.height ?? 0
  }
}
