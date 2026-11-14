import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger, redact } from '../logger'

/**
 * Alt ajan izleme günlüğü — yapılandırılmış JSONL.
 *
 * ## Neden ayrı bir günlük
 *
 * `main.log` insan okuması için; alt ajan hatalarını **sayısal olarak takip
 * etmek** için yetersiz. Canlı koşuda (0.4.13) bir explore ajanı 186 sn
 * çalışıp sonuç üretti, `task_wait` 120 sn'de düştü ve sonuç kayboldu. Bu
 * olay `main.log`'da tek satırlık "Alt ajan reddedildi" olarak görünüyordu;
 * hangi aşamada, kaç araçla, ne kadar sürede takıldığı bilinmiyordu.
 *
 * ## Biçim
 *
 * Her satır bir JSON nesnesi:
 *
 * ```json
 * {"at":1794...,"phase":"tool","level":"info","taskId":"sub-…","agentType":"explore",
 *  "msg":"write_file ok=false","data":{"durationMs":41,"error":"…"}}
 * ```
 *
 * Alanlar:
 * - `phase` — yaşam döngüsü aşaması (`spawn`, `gate`, `ownership`, `start`,
 *   `step`, `tool`, `budget`, `synthesis`, `finish`, `error`, `state`, `resume`)
 * - `level` — `info` | `warn` | `error`
 * - `taskId` / `requestId` — ilişkilendirme
 * - `data` — serbest alan (süre, araç adı, adım, kısmi neden …)
 *
 * ## Dosyalar
 *
 * `<userData>/logs/subagent-events.jsonl` — 4 MB'da döner; tek yedek
 * (`subagent-events.1.jsonl`). Ayrıca son 400 olay bellekte tutulur; dosya
 * yazılamazsa (ayrı süreç, izin) tanılama yine çalışır.
 *
 * Sırlar `redact()` ile maskelenir: günlük bir tanılama aracıdır, sızıntı
 * kanalı olmamalıdır.
 */

export type SubagentLogPhase =
  | 'spawn'
  | 'gate'
  | 'ownership'
  | 'start'
  | 'step'
  | 'tool'
  | 'budget'
  | 'synthesis'
  | 'finish'
  | 'error'
  | 'state'
  | 'resume'

export type SubagentLogLevel = 'info' | 'warn' | 'error'

export interface SubagentLogEvent {
  at: number
  phase: SubagentLogPhase
  level: SubagentLogLevel
  msg: string
  taskId?: string
  requestId?: string
  agentType?: string
  data?: Record<string, unknown>
}

export interface SubagentLogInput {
  phase: SubagentLogPhase
  msg: string
  level?: SubagentLogLevel
  taskId?: string
  requestId?: string
  agentType?: string
  data?: Record<string, unknown>
}

const log = createLogger('agent/subagentLog')

/** Dosya boyutu sınırı: aşılırsa tek yedekle döner. */
function maxBytes(): number {
  // Testler için ayarlanabilir; varsayılan 4 MB.
  const override = Number(process.env['EVREN_SUBAGENT_LOG_MAX_BYTES'])
  return Number.isFinite(override) && override > 0 ? override : 4 * 1024 * 1024
}
/** Bellekte tutulan olay sayısı (dosya yazılamasa bile tanılama için). */
const RING_SIZE = 400

const ring: SubagentLogEvent[] = []
let writeFailed = false
let cachedDir: string | null = null

function logDirectory(): string {
  if (cachedDir) return cachedDir
  const override = process.env['EVREN_SUBAGENT_LOG_DIR']
  if (override) {
    cachedDir = override
    return override
  }
  try {
    cachedDir = app.getPath('logs')
  } catch {
    try {
      cachedDir = join(app.getPath('userData'), 'logs')
    } catch {
      // Ayrı süreçte `app` yok; ana süreç `EVREN_USER_DATA` geçirir.
      // `EVREN_DATA_DIR` testlerde kullanılır.
      cachedDir = join(
        process.env['EVREN_USER_DATA'] ?? process.env['EVREN_DATA_DIR'] ?? process.cwd(),
        'logs'
      )
    }
  }
  return cachedDir
}

function logFile(): string {
  return join(logDirectory(), 'subagent-events.jsonl')
}

function sanitize(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      // Uzun metinleri kırp: günlük bir dizindir, içerik arşivi değil.
      output[key] = value.length > 2000 ? `${redact(value.slice(0, 2000))}…` : redact(value)
    } else if (value instanceof Error) {
      output[key] = { name: value.name, message: redact(value.message), stack: redact(value.stack ?? '') }
    } else if (value !== undefined) {
      output[key] = value
    }
  }
  return output
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return
    if (statSync(file).size < maxBytes()) return
    const backup = file.replace(/\.jsonl$/, '.1.jsonl')
    renameSync(file, backup)
  } catch {
    // Döndürme başarısızsa yazmaya devam et; kırpma ikincil.
  }
}

/**
 * Tek bir alt ajan olayını kaydeder.
 *
 * Asenkron yapılmadı: alt ajan döngüsünde her araç çağrısının ardından
 * çağrılıyor; `await` eklemek gecikme ve sıra sorunu getirirdi. Yazma
 * senkron `appendFileSync` ve hata yutulur — tanılama, işin kendisini
 * engellememeli.
 */
export function logSubagent(input: SubagentLogInput): SubagentLogEvent {
  const event: SubagentLogEvent = {
    at: Date.now(),
    phase: input.phase,
    level: input.level ?? 'info',
    // Mesaj da sır içerebilir (hata metni bir URL/token gömebilir).
    msg: redact(input.msg),
    taskId: input.taskId,
    requestId: input.requestId,
    agentType: input.agentType,
    data: sanitize(input.data)
  }

  ring.push(event)
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)

  // Ayrıca ana günlüğe düş: kullanıcı `main.log`'a baktığında özet görsün.
  const scope = [
    event.agentType ?? '-',
    event.taskId ? event.taskId.slice(0, 12) : '-',
    event.phase
  ].join('/')
  const text = `[${scope}] ${event.msg}`
  if (event.level === 'error') log.error(text)
  else if (event.level === 'warn') log.warn(text)
  else log.debug(text)

  if (writeFailed) return event

  try {
    mkdirSync(logDirectory(), { recursive: true })
    const file = logFile()
    rotateIfNeeded(file)
    appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8')
  } catch (error) {
    writeFailed = true
    log.warn(
      `Alt ajan günlüğü dosyaya yazılamadı; yalnızca bellekte tutulacak: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return event
}

export interface SubagentLogQuery {
  taskId?: string
  requestId?: string
  /** En az bu önem düzeyindeki olaylar. */
  level?: SubagentLogLevel
  /** Son kaç olay (varsayılan 100). */
  limit?: number
}

const LEVEL_ORDER: Record<SubagentLogLevel, number> = { info: 0, warn: 1, error: 2 }

function matches(event: SubagentLogEvent, query: SubagentLogQuery): boolean {
  if (query.taskId && event.taskId !== query.taskId) return false
  if (query.requestId && event.requestId !== query.requestId) return false
  if (query.level && LEVEL_ORDER[event.level] < LEVEL_ORDER[query.level]) return false
  return true
}

/**
 * Son alt ajan olaylarını okur.
 *
 * Önce dosya, sonra bellek: dosya döndürülmüşse (rotation) eski olaylar
 * kaybolabilir; bu yüzden yedek dosya da okunur.
 */
export function readSubagentLogs(query: SubagentLogQuery = {}): SubagentLogEvent[] {
  const limit = Math.max(1, Math.min(2000, query.limit ?? 100))
  const events: SubagentLogEvent[] = []

  for (const file of [logFile().replace(/\.jsonl$/, '.1.jsonl'), logFile()]) {
    try {
      if (!existsSync(file)) continue
      const raw = readFileSync(file, 'utf8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as SubagentLogEvent
          if (matches(parsed, query)) events.push(parsed)
        } catch {
          // bozuk satır: atla
        }
      }
    } catch {
      // okunamadı: belleğe düş
    }
  }

  // Dosyada hiç olay yoksa (veya yazma başarısızsa) bellek ring'i kullan.
  if (events.length === 0) {
    for (const event of ring) if (matches(event, query)) events.push(event)
  }

  events.sort((left, right) => left.at - right.at)
  return events.slice(-limit)
}

export interface SubagentLogSummary {
  total: number
  errors: number
  warnings: number
  /** Aşama → olay sayısı. */
  phases: Record<string, number>
  /** Hata mesajları (en yeni önce, en fazla 10). */
  errorMessages: string[]
  firstAt?: number
  lastAt?: number
}

/** Verilen görev/istek için sayısal özet — "tespit takibi" için. */
export function summarizeSubagentLogs(query: SubagentLogQuery = {}): SubagentLogSummary {
  const events = readSubagentLogs({ ...query, limit: 2000 })
  const phases: Record<string, number> = {}
  const errorMessages: string[] = []
  let errors = 0
  let warnings = 0
  for (const event of events) {
    phases[event.phase] = (phases[event.phase] ?? 0) + 1
    if (event.level === 'error') {
      errors += 1
      if (errorMessages.length < 10) errorMessages.unshift(event.msg)
    }
    if (event.level === 'warn') warnings += 1
  }
  return {
    total: events.length,
    errors,
    warnings,
    phases,
    errorMessages,
    firstAt: events[0]?.at,
    lastAt: events[events.length - 1]?.at
  }
}

/** Modele/günlüğe dönük kompakt metin. */
export function formatSubagentLogs(events: SubagentLogEvent[]): string {
  if (events.length === 0) return 'Kayıt yok.'
  return events
    .map((event) => {
      const time = new Date(event.at).toLocaleTimeString('tr-TR')
      const level = event.level === 'error' ? 'HATA' : event.level === 'warn' ? 'UYARI' : 'bilgi'
      const task = event.taskId ? ` ${event.taskId.slice(0, 12)}` : ''
      const phase = event.phase.padEnd(10)
      const detail = event.data ? ` ${JSON.stringify(event.data).slice(0, 220)}` : ''
      return `${time} ${level.padEnd(5)} ${phase}${task} ${event.msg}${detail}`
    })
    .join('\n')
}

/** Testler için: bellek ring'ini boşaltır (dosyaya dokunmaz). */
export function resetSubagentLogRing(): void {
  ring.length = 0
  writeFailed = false
  cachedDir = null
}
