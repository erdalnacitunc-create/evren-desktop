import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { withAndroidPath } from '../android'

const execFileAsync = promisify(execFile)

const MAX_SCRIPT_TIMEOUT = 600_000

function tempDir(): string {
  return join(app.getPath('temp'), 'evren-scripts')
}

async function writeTemp(name: string, content: string): Promise<string> {
  const dir = tempDir()
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`)
  await fs.writeFile(file, content, 'utf8')
  return file
}

export interface ScriptResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  scriptPath?: string
}

/** Python kodunu geçici dosyaya yazıp çalıştırır (tırnak kaçışı sorunu olmadan). */
export async function runPythonScript(
  code: string,
  options: { args?: string[]; cwd?: string; timeoutMs?: number; pythonPath?: string } = {}
): Promise<ScriptResult> {
  const started = Date.now()
  const file = await writeTemp('script.py', code)
  const timeout = Math.min(
    MAX_SCRIPT_TIMEOUT,
    Math.max(1000, Math.round(Number(options.timeoutMs) || 120_000))
  )
  const env = {
    ...(await withAndroidPath()),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
  try {
    const result = await execFileAsync(
      options.pythonPath || 'python',
      [file, ...(options.args ?? [])],
      {
        cwd: options.cwd ?? app.getPath('temp'),
        env,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8'
      }
    )
    return {
      ok: true,
      exitCode: 0,
      stdout: String(result.stdout ?? '').slice(0, 40_000),
      stderr: String(result.stderr ?? '').slice(0, 12_000),
      durationMs: Date.now() - started,
      scriptPath: file
    }
  } catch (error) {
    const err = error as {
      stdout?: string
      stderr?: string
      code?: number | string
      message?: string
      killed?: boolean
    }
    return {
      ok: false,
      exitCode: typeof err.code === 'number' ? err.code : err.killed ? 124 : 1,
      stdout: String(err.stdout ?? '').slice(0, 40_000),
      stderr: String(err.stderr ?? err.message ?? '').slice(0, 12_000),
      durationMs: Date.now() - started,
      scriptPath: file
    }
  } finally {
    void fs.unlink(file).catch(() => undefined)
  }
}

export interface UsbDevice {
  name: string
  instanceId: string
  status: string
  vendorId?: string
  productId?: string
}

export interface SerialPort {
  device: string
  description: string
  pnpDeviceId?: string
}

export interface UsbInventory {
  devices: UsbDevice[]
  serialPorts: SerialPort[]
  usbDisks: Array<{ model: string; serial?: string }>
  adbDevices: string[]
  adbAvailable: boolean
  python: { available: boolean; version?: string; pyserial?: string; esptool?: string }
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$usb = Get-PnpDevice -PresentOnly -Class USB |
  Select-Object @{n='name';e={$_.FriendlyName}},
                @{n='instanceId';e={$_.InstanceId}},
                @{n='status';e={[string]$_.Status}}

$serial = Get-CimInstance Win32_SerialPort |
  Select-Object @{n='device';e={$_.DeviceID}},
                @{n='description';e={$_.Description}},
                @{n='pnpDeviceId';e={$_.PNPDeviceID}}

$disks = Get-CimInstance Win32_DiskDrive |
  Where-Object { $_.InterfaceType -eq 'USB' } |
  Select-Object @{n='model';e={$_.Model}},
                @{n='serial';e={$_.SerialNumber}}

@{ usb = @($usb); serial = @($serial); disks = @($disks) } |
  ConvertTo-Json -Depth 5 -Compress
`

async function queryWindowsUsb(): Promise<{
  usb: UsbDevice[]
  serial: SerialPort[]
  disks: Array<{ model: string; serial?: string }>
}> {
  const file = await writeTemp('usb.ps1', PS_SCRIPT)
  try {
    const result = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }
    )
    const raw = String(result.stdout ?? '').trim()
    const parsed = JSON.parse(raw || '{}') as {
      usb?: Array<{ name?: string; instanceId?: string; status?: string }>
      serial?: Array<{ device?: string; description?: string; pnpDeviceId?: string }>
      disks?: Array<{ model?: string; serial?: string }>
    }
    const usb: UsbDevice[] = (parsed.usb ?? [])
      .filter((item) => item.instanceId)
      .map((item) => {
        const match = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(item.instanceId ?? '')
        return {
          name: item.name ?? '(bilinmiyor)',
          instanceId: item.instanceId ?? '',
          status: item.status ?? 'Unknown',
          vendorId: match?.[1]?.toUpperCase(),
          productId: match?.[2]?.toUpperCase()
        }
      })
    const serial: SerialPort[] = (parsed.serial ?? [])
      .filter((item) => item.device)
      .map((item) => ({
        device: item.device ?? '',
        description: item.description ?? '',
        pnpDeviceId: item.pnpDeviceId
      }))
    const disks = (parsed.disks ?? [])
      .filter((item) => item.model)
      .map((item) => ({ model: item.model ?? '', serial: item.serial }))
    return { usb, serial, disks }
  } finally {
    void fs.unlink(file).catch(() => undefined)
  }
}

async function queryLinuxUsb(): Promise<{
  usb: UsbDevice[]
  serial: SerialPort[]
  disks: Array<{ model: string; serial?: string }>
}> {
  const read = async (command: string, args: string[]): Promise<string> => {
    try {
      const result = await execFileAsync(command, args, {
        timeout: 20_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8'
      })
      return String(result.stdout ?? '')
    } catch {
      return ''
    }
  }

  const lsusb = await read('lsusb', [])
  const usb: UsbDevice[] = lsusb
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s*(.*)$/i.exec(line)
      return {
        name: match?.[3]?.trim() || line.trim(),
        instanceId: line.trim(),
        status: 'OK',
        vendorId: match?.[1]?.toUpperCase(),
        productId: match?.[2]?.toUpperCase()
      }
    })

  const devList = await read('sh', ['-c', 'ls -1 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null'])
  const serial: SerialPort[] = devList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((device) => ({ device, description: 'Seri port' }))

  const lsblk = await read('sh', [
    '-c',
    "lsblk -J -o NAME,MODEL,SERIAL,TRAN 2>/dev/null"
  ])
  let disks: Array<{ model: string; serial?: string }> = []
  try {
    const parsed = JSON.parse(lsblk || '{}') as {
      blockdevices?: Array<{ model?: string; serial?: string; tran?: string }>
    }
    disks = (parsed.blockdevices ?? [])
      .filter((item) => (item.tran ?? '').toLowerCase() === 'usb')
      .map((item) => ({ model: item.model ?? '', serial: item.serial ?? undefined }))
  } catch {
    disks = []
  }

  return { usb, serial, disks }
}

async function queryPython(): Promise<UsbInventory['python']> {
  const env = { ...(await withAndroidPath()), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  const probe = async (code: string): Promise<string | null> => {
    const file = await writeTemp('probe.py', code)
    try {
      const result = await execFileAsync('python', [file], {
        timeout: 20_000,
        maxBuffer: 512 * 1024,
        windowsHide: true,
        encoding: 'utf8',
        env
      })
      return String(result.stdout ?? '').trim()
    } catch {
      return null
    } finally {
      void fs.unlink(file).catch(() => undefined)
    }
  }
  const version = await probe('import sys; print(sys.version.split()[0])')
  const pyserial = await probe('import serial; print(serial.__version__)')
  const esptool = await probe('import esptool; print(esptool.__version__)')
  return {
    available: !!version,
    version: version ?? undefined,
    pyserial: pyserial ?? undefined,
    esptool: esptool ?? undefined
  }
}

async function queryAdb(): Promise<{ available: boolean; devices: string[] }> {
  const env = await withAndroidPath()
  try {
    const result = await execFileAsync('adb', ['devices'], {
      timeout: 20_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      env
    })
    const devices = String(result.stdout ?? '')
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('*'))
    return { available: true, devices }
  } catch {
    return { available: false, devices: [] }
  }
}

export async function queryUsbInventory(): Promise<UsbInventory> {
  const platform = await (process.platform === 'win32' ? queryWindowsUsb() : queryLinuxUsb())
  const [adb, python] = await Promise.all([queryAdb(), queryPython()])
  return {
    devices: platform.usb,
    serialPorts: platform.serial,
    usbDisks: platform.disks,
    adbDevices: adb.devices,
    adbAvailable: adb.available,
    python
  }
}

/** Uzun süre çalışan donanım komutları için (ör. flash) arka plan başlatma. */
export async function startBackgroundScript(
  command: string,
  args: string[],
  cwd: string
): Promise<{ pid?: number }> {
  const env = {
    ...(await withAndroidPath()),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  return { pid: child.pid }
}
