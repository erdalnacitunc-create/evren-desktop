import { app } from 'electron'
import log from 'electron-log/main'
import { renameSync } from 'fs'
import { join } from 'path'

/**
 * Uygulama günlüğü.
 *
 * - Dosya: <userData>/logs/main.log (5 MB'da döner, 1 yedek)
 * - Geliştirmede ayrıca konsola yazar, pakette yalnızca dosyaya
 * - Hassas değerler (API anahtarı, GitHub token, Bearer) yazılmadan önce maskelenir
 */

const isPackaged = app?.isPackaged === true

type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'
const VALID_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug', 'silly']

function resolveLevel(): LogLevel {
  const raw = (process.env['EVREN_LOG_LEVEL'] ?? '').toLowerCase() as LogLevel
  if (VALID_LEVELS.includes(raw)) return raw
  return isPackaged ? 'info' : 'debug'
}

const level = resolveLevel()

function logDirectory(): string {
  try {
    return app.getPath('logs')
  } catch {
    try {
      return join(app.getPath('userData'), 'logs')
    } catch {
      return join(process.cwd(), 'logs')
    }
  }
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-***'],
  [/\bevren_[A-Za-z0-9_-]{16,}\b/g, 'evren_***'],
  [/\bghp_[A-Za-z0-9]{16,}\b/g, 'ghp_***'],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, 'github_pat_***'],
  [/\bgho_[A-Za-z0-9]{16,}\b/g, 'gho_***'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'xox*-***'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer ***'],
  [/("?(?:api[-_]?key|token|secret|password|authorization)"?\s*[:=]\s*")([^"]{4,})(")/gi, '$1***$3']
]

/** Günlüğe yazılmadan önce metindeki bilinen sır kalıplarını maskeler. */
export function redact(value: string): string {
  let output = value
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

function redactData(data: unknown[]): unknown[] {
  return data.map((item) => {
    if (typeof item === 'string') return redact(item)
    if (item instanceof Error) {
      // Hata mesajı ve yığını da sır içerebilir.
      const copy = new Error(redact(item.message))
      copy.name = item.name
      copy.stack = item.stack ? redact(item.stack) : item.stack
      return copy
    }
    return item
  })
}

log.hooks.push((message, transport) => {
  if (transport === log.transports.file || transport === log.transports.console) {
    message.data = redactData(message.data)
  }
  return message
})

log.transports.file.level = level
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}'
log.transports.file.resolvePathFn = () => join(logDirectory(), 'main.log')
log.transports.file.archiveLogFn = (file) => {
  try {
    renameSync(file.path, `${file.path}.1`)
  } catch {
    try {
      file.clear()
    } catch {
      // yedek oluşturulamazsa dosya bir sonraki yazımda üzerine yazılır
    }
  }
}

log.transports.console.level = isPackaged ? false : level
log.transports.console.format = '{h}:{i}:{s} [{level}]{scope} {text}'

/** Yakalanmayan hataları günlüğe yazar; kullanıcıya iletişim kutusu göstermez. */
export function installCrashLogging(): void {
  log.errorHandler.startCatching({ showDialog: false })
  process.on('unhandledRejection', (reason) => {
    log.error('İşlenmeyen Promise reddi:', reason)
  })
}

export const logger = log
export type Logger = Pick<typeof log, 'debug' | 'info' | 'warn' | 'error' | 'verbose'>

/** Modül bazlı günlükçü: scope etiketiyle yazar. */
export function createLogger(scope: string): Logger {
  return log.scope(scope)
}

export function logFilePath(): string {
  return join(logDirectory(), 'main.log')
}
