import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

let cachedAdb: { path: string | null; at: number } | null = null
const CACHE_MS = 30_000

function candidatePaths(): string[] {
  const candidates: string[] = []
  const envRoots = [
    process.env['ANDROID_SDK_ROOT'],
    process.env['ANDROID_HOME'],
    process.env['ANDROID_SDK_HOME']
  ].filter((value): value is string => !!value && value.trim().length > 0)

  for (const root of envRoots) {
    candidates.push(join(root, 'platform-tools', 'adb.exe'))
    candidates.push(join(root, 'platform-tools', 'adb'))
  }

  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA']
    const userProfile = process.env['USERPROFILE']
    if (localAppData) {
      candidates.push(join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'))
      candidates.push(join(localAppData, 'Android', 'platform-tools', 'adb.exe'))
    }
    if (userProfile) {
      candidates.push(join(userProfile, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'))
      candidates.push(join(userProfile, 'Android', 'Sdk', 'platform-tools', 'adb.exe'))
    }
    candidates.push('C:\\Android\\platform-tools\\adb.exe')
    candidates.push('C:\\Program Files\\Android\\platform-tools\\adb.exe')
  } else {
    candidates.push('/usr/local/bin/adb')
    candidates.push('/usr/bin/adb')
    candidates.push('/opt/android-sdk/platform-tools/adb')
  }

  return candidates
}

async function findOnPath(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const result = await execFileAsync('where.exe', ['adb'], {
        timeout: 3000,
        windowsHide: true
      })
      const first = String(result.stdout ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      return first ?? null
    }
    const result = await execFileAsync('sh', ['-lc', 'command -v adb'], {
      timeout: 3000
    })
    const first = String(result.stdout ?? '').trim().split(/\r?\n/)[0]
    return first || null
  } catch {
    return null
  }
}

/** Android platform-tools/adb yolunu bulur; bulamazsa null döner. */
export async function findAdbPath(force = false): Promise<string | null> {
  if (!force && cachedAdb && Date.now() - cachedAdb.at < CACHE_MS) {
    return cachedAdb.path
  }

  let found: string | null = null
  for (const candidate of candidatePaths()) {
    if (existsSync(candidate)) {
      found = candidate
      break
    }
  }
  if (!found) found = await findOnPath()

  cachedAdb = { path: found, at: Date.now() }
  return found
}

/**
 * Alt süreçlere ADB'nin bulunduğu klasörü PATH'e ekler.
 * GUI'den başlatılan Electron süreçleri terminal PATH'ini almayabilir.
 */
export async function withAndroidPath(
  base: NodeJS.ProcessEnv = process.env
): Promise<NodeJS.ProcessEnv> {
  const adb = await findAdbPath()
  if (!adb) return { ...base }
  const dir = dirname(adb)
  const currentPath = base.PATH ?? base.Path ?? ''
  const nextPath = currentPath
    ? `${dir}${delimiter}${currentPath}`
    : dir
  return {
    ...base,
    PATH: nextPath,
    EVREN_ADB_PATH: adb
  }
}
