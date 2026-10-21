import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { TerminalStatus } from '../shared/types'
import { getWorkspaceRoot } from './workspace'

let child: ChildProcessWithoutNullStreams | null = null
let currentCwd = ''
let statusError: string | undefined
let outputBuffer = ''
let broadcastTimer: NodeJS.Timeout | null = null
let pendingBroadcast = ''

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
const MAX_BUFFER = 300_000
const MAX_INLINE_CODE = 20_000

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function flushBroadcast(): void {
  broadcastTimer = null
  if (!pendingBroadcast) return
  const data = pendingBroadcast
  pendingBroadcast = ''
  broadcast('terminal:data', { data })
}

function emit(raw: string): void {
  const data = raw.replace(ANSI, '').replace(/\r/g, '')
  if (!data) return
  outputBuffer = (outputBuffer + data).slice(-MAX_BUFFER)
  pendingBroadcast += data
  if (pendingBroadcast.length > 16_000) {
    if (broadcastTimer) clearTimeout(broadcastTimer)
    flushBroadcast()
    return
  }
  if (!broadcastTimer) {
    broadcastTimer = setTimeout(flushBroadcast, 30)
  }
}

function shellCommand(): { command: string; args: string[]; label: string } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      label: 'PowerShell'
    }
  }
  return { command: process.env.SHELL || '/bin/bash', args: [], label: 'Shell' }
}

export function terminalStatus(): TerminalStatus {
  return {
    running: !!child,
    cwd: currentCwd || null,
    shell: child ? shellCommand().label : null,
    error: statusError
  }
}

export async function startTerminal(forceCwd?: string): Promise<TerminalStatus> {
  const workspace = await getWorkspaceRoot()
  const cwd = forceCwd || workspace || app.getPath('home')
  if (child && currentCwd === cwd) return terminalStatus()
  stopTerminal()

  const shell = shellCommand()
  currentCwd = cwd
  statusError = undefined
  outputBuffer = ''

  try {
    child = spawn(shell.command, shell.args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PYTHONIOENCODING: 'utf-8'
      }
    })
  } catch (error) {
    statusError = error instanceof Error ? error.message : String(error)
    child = null
    return terminalStatus()
  }

  const proc = child
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => emit(chunk))
  proc.stderr.on('data', (chunk: string) => emit(chunk))
  proc.on('error', (error) => {
    statusError = error.message
    emit(`\n[terminal hatası] ${error.message}\n`)
  })
  proc.on('exit', (code, signal) => {
    emit(`\n[terminal kapandı: ${signal ?? code ?? 0}]\n`)
    if (child === proc) child = null
    broadcast('terminal:exit', { code, signal })
  })

  emit(`EVREN Terminal — ${shell.label}\n${cwd}\n\n`)
  if (process.platform === 'win32') {
    proc.stdin.write(
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
        '$OutputEncoding=[System.Text.Encoding]::UTF8;\n'
    )
  }
  return terminalStatus()
}

export function stopTerminal(): void {
  if (!child) return
  try {
    child.kill()
  } catch {
    // yut
  }
  child = null
}

export function interruptTerminal(): void {
  stopTerminal()
  statusError = undefined
  broadcast('terminal:exit', { code: null, signal: 'SIGINT' })
}

export async function writeTerminal(raw: string): Promise<boolean> {
  if (!child) await startTerminal()
  if (!child) return false
  const text = String(raw ?? '')
  if (!text) return false
  const clean = text.replace(/\r?\n$/, '')
  if (clean) emit(`${clean}\n`)
  child.stdin.write(text.endsWith('\n') ? text : `${text}\n`)
  return true
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function commandFor(language: string, code: string): { command: string; label: string } | null {
  const lang = language.toLowerCase()
  const encoded = base64(code)
  if (lang === 'python' || lang === 'py' || lang === 'python3') {
    return {
      command: `python -c "import base64;exec(base64.b64decode('${encoded}').decode('utf-8'))"`,
      label: 'Python'
    }
  }
  if (lang === 'node' || lang === 'js' || lang === 'javascript' || lang === 'mjs') {
    return {
      command: `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`,
      label: 'Node.js'
    }
  }
  if (lang === 'powershell' || lang === 'ps1' || lang === 'pwsh') {
    const utf16 = Buffer.from(code, 'utf16le').toString('base64')
    return {
      command: `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${utf16}`,
      label: 'PowerShell'
    }
  }
  if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') {
    return {
      command: `bash -lc "echo ${encoded} | base64 -d | bash"`,
      label: 'Bash'
    }
  }
  return null
}

export async function runTerminalCode(
  language: string,
  code: string
): Promise<{ ok: boolean; command?: string; label?: string; error?: string }> {
  if (!code.trim()) return { ok: false, error: 'Kod boş.' }
  if (code.length > MAX_INLINE_CODE) {
    return {
      ok: false,
      error: `Kod çok büyük (${code.length} karakter). Sınır: ${MAX_INLINE_CODE}.`
    }
  }
  const generated = commandFor(language, code)
  if (!generated) {
    return { ok: false, error: `Bu dil tek tuşla çalıştırılamıyor: ${language || 'bilinmiyor'}` }
  }
  const workspace = await getWorkspaceRoot()
  if (!workspace) {
    return { ok: false, error: 'Tek tuşla çalıştırmak için önce bir çalışma alanı seçin.' }
  }
  await startTerminal(workspace)
  if (!child) return { ok: false, error: statusError ?? 'Terminal başlatılamadı.' }
  emit(`\n> [${generated.label}] kod çalıştırılıyor...\n`)
  child.stdin.write(`${generated.command}\n`)
  return { ok: true, command: generated.command, label: generated.label }
}
