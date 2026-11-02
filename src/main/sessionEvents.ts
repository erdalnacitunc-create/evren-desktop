import { appendFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { createLogger } from './logger'
import { rotateEventsFile } from './sessionEventsRotation'

/**
 * Kalıcı oturum olay günlüğü — OpenCode `Event.durable` + `SessionProjector`
 * mimarisinin dosya tabanlı karşılığı.
 *
 * OpenCode her kalıcı olayı `{ aggregate: "sessionID", version }` ile bir olay
 * günlüğüne yazar, sonra bir "projector" bu olayları mesaj tablolarına katlar.
 * Arayüz `session.sync` ile her an yeniden kurabilir; süreç çökse bile
 * kaybolan veri olmaz.
 *
 * Bizde:
 *  - Olay günlüğü: `<userData>/session-events.jsonl` (satır başına bir olay)
 *  - Her olay: `{ seq, sessionId, type, at, data }`
 *  - `projectSession()` olayları sırayla uygulayıp mesaj listesini üretir
 *  - Projeksiyon **saf** fonksiyondur; disk/ağ erişimi yoktur, test edilebilir
 *
 * Neden JSONL? Ekleme atomiktir, yarım yazma yalnızca son satırı bozar ve o
 * satır atlanır. Tüm dosyayı yeniden yazmak gerekmez.
 */

const log = createLogger('sessionEvents')

/** Günlük olay türleri. OpenCode `session.*` olaylarıyla eşlenir. */
export type SessionEventType =
  | 'session.created'
  | 'user.message'
  | 'assistant.started'
  | 'text.delta'
  | 'reasoning.delta'
  | 'retry.scheduled'
  | 'retry.cleared'
  | 'continue.started'
  | 'step.ended'
  | 'tool.called'
  | 'tool.result'
  | 'assistant.completed'
  | 'assistant.failed'
  | 'session.renamed'

export interface SessionEvent {
  /** Oturum içinde artan sıra numarası (1 tabanlı). */
  seq: number
  sessionId: string
  type: SessionEventType
  /** Olay zamanı (ms). */
  at: number
  data: Record<string, unknown>
}

/** Projeksiyon sonucu: yeniden kurulmuş mesajlar + tanılama. */
export interface ProjectedSession {
  messages: ProjectedMessage[]
  /** En yüksek sıra numarası (sonraki olay için). */
  lastSeq: number
  /** Atlanan/bozuk olay sayısı. */
  skipped: number
  /** Günlükte görülen ama uygulanamayan olay türleri. */
  unknownTypes: string[]
}

export interface ProjectedMessage {
  messageId: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  createdAt: number
  finishReason?: string | null
  usage?: unknown
  retry?: {
    attempt: number
    at: number
    error: { type: string; message: string; status?: number; retryAfterMs?: number }
  }
  continuations?: number
  /** Araç çağrıları (sıralı). */
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  toolResults: Array<{ toolCallId: string; name: string; ok: boolean; content: string }>
}

function eventsFile(): string {
  return join(app.getPath('userData'), 'session-events.jsonl')
}

/** Testler için yol geçersiz kılma. */
let overridePath: string | null = null
export function __setEventsPath(path: string | null): void {
  overridePath = path
}

function targetFile(): string {
  return overridePath ?? eventsFile()
}

/**
 * Bir olayı günlüğe ekler.
 * Yazma başarısız olursa **fırlatmaz**; akış günlük yüzden durmamalı.
 * Ama hatayı loglar ve `false` döner.
 *
 * Döndürme: her 500 olayda bir dosya boyutu kontrol edilir; eşik aşıldıysa
 * arşivlenir (bkz. `sessionEventsRotation.ts`). Kontrol seyrek yapılır çünkü
 * `stat` çağrısı her olayda ek maliyet olurdu.
 */
let appendCount = 0
const ROTATE_CHECK_EVERY = 500

export async function appendSessionEvent(
  event: Omit<SessionEvent, 'at'> & { at?: number }
): Promise<boolean> {
  const record: SessionEvent = {
    seq: event.seq,
    sessionId: event.sessionId,
    type: event.type,
    at: event.at ?? Date.now(),
    data: event.data
  }
  try {
    const file = targetFile()
    await mkdir(app.getPath('userData'), { recursive: true })

    appendCount += 1
    if (appendCount % ROTATE_CHECK_EVERY === 0) {
      await rotateEventsFile(file).catch(() => undefined)
    }

    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
    return true
  } catch (error) {
    log.warn('Olay günlüğe yazılamadı:', error)
    return false
  }
}

/** Oturum başına son sıra numarasını bellekte tutar (ekleme hızlı olsun). */
const lastSeqBySession = new Map<string, number>()

export function nextSeq(sessionId: string): number {
  const current = lastSeqBySession.get(sessionId) ?? 0
  const next = current + 1
  lastSeqBySession.set(sessionId, next)
  return next
}

export function seedSeq(sessionId: string, value: number): void {
  lastSeqBySession.set(sessionId, Math.max(lastSeqBySession.get(sessionId) ?? 0, value))
}

export function resetSeqCache(): void {
  lastSeqBySession.clear()
}

/**
 * Günlük dosyasını okur ve oturumlara göre gruplar.
 * Bozuk satırlar **atlanır**, tüm dosya düşmez.
 */
export async function readEvents(): Promise<{
  bySession: Map<string, SessionEvent[]>
  skipped: number
}> {
  const bySession = new Map<string, SessionEvent[]>()
  let skipped = 0
  let text = ''
  try {
    text = await readFile(targetFile(), 'utf8')
  } catch {
    return { bySession, skipped: 0 }
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      skipped += 1
      continue
    }
    if (!isEvent(parsed)) {
      skipped += 1
      continue
    }
    const list = bySession.get(parsed.sessionId) ?? []
    list.push(parsed)
    bySession.set(parsed.sessionId, list)
  }

  // Sıra numarasına göre sırala (dosya sırası bozulursa).
  for (const list of bySession.values()) list.sort((a, b) => a.seq - b.seq)
  return { bySession, skipped }
}

function isEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record['seq'] === 'number' &&
    typeof record['sessionId'] === 'string' &&
    typeof record['type'] === 'string' &&
    typeof record['at'] === 'number'
  )
}

const KNOWN_TYPES = new Set<SessionEventType>([
  'session.created',
  'user.message',
  'assistant.started',
  'text.delta',
  'reasoning.delta',
  'retry.scheduled',
  'retry.cleared',
  'continue.started',
  'step.ended',
  'tool.called',
  'tool.result',
  'assistant.completed',
  'assistant.failed',
  'session.renamed'
])

/**
 * Olayları mesajlara **katlar** (OpenCode projector ile aynı iş).
 *
 * Saf fonksiyon: disk, ağ veya saat erişimi yoktur; aynı olay listesi her
 * zaman aynı mesajları üretir. Bu yüzden test edilebilir ve yeniden
 * çalıştırılabilir.
 */
export function projectSession(events: SessionEvent[]): ProjectedSession {
  const messages: ProjectedMessage[] = []
  const byId = new Map<string, ProjectedMessage>()
  const unknownTypes = new Set<string>()
  let skipped = 0
  let lastSeq = 0

  const currentAssistant = (): ProjectedMessage | null =>
    messages.length > 0 && messages[messages.length - 1]?.role === 'assistant'
      ? (messages[messages.length - 1] as ProjectedMessage)
      : null

  for (const event of events) {
    lastSeq = Math.max(lastSeq, event.seq)
    if (!KNOWN_TYPES.has(event.type)) {
      unknownTypes.add(event.type)
      continue
    }
    // Bozuk yük: atla ama say.
    if (!event.data || typeof event.data !== 'object') {
      skipped += 1
      continue
    }

    const data = event.data as Record<string, unknown>
    const messageId = typeof data['messageId'] === 'string' ? data['messageId'] : null

    switch (event.type) {
      case 'session.created':
      case 'session.renamed':
        break

      case 'user.message': {
        const id = messageId ?? `user-${event.seq}`
        const message: ProjectedMessage = {
          messageId: id,
          role: 'user',
          content: typeof data['content'] === 'string' ? data['content'] : '',
          reasoning: '',
          createdAt: event.at,
          toolCalls: [],
          toolResults: []
        }
        messages.push(message)
        byId.set(id, message)
        break
      }

      case 'assistant.started': {
        const id = messageId ?? `assistant-${event.seq}`
        const message: ProjectedMessage = {
          messageId: id,
          role: 'assistant',
          content: '',
          reasoning: '',
          createdAt: event.at,
          toolCalls: [],
          toolResults: []
        }
        messages.push(message)
        byId.set(id, message)
        break
      }

      case 'text.delta': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target || typeof data['text'] !== 'string') {
          skipped += 1
          break
        }
        target.content += data['text']
        break
      }

      case 'reasoning.delta': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target || typeof data['text'] !== 'string') {
          skipped += 1
          break
        }
        target.reasoning += data['text']
        break
      }

      case 'retry.scheduled': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target) {
          skipped += 1
          break
        }
        const attempt = Number(data['attempt'])
        const at = Number(data['at'])
        const rawError = data['error']
        const errorRecord =
          rawError && typeof rawError === 'object' ? (rawError as Record<string, unknown>) : {}
        target.retry = {
          attempt: Number.isFinite(attempt) ? Math.round(attempt) : 1,
          at: Number.isFinite(at) ? Math.round(at) : event.at,
          error: {
            type: typeof errorRecord['type'] === 'string' ? errorRecord['type'] : 'UnknownProvider',
            message:
              typeof errorRecord['message'] === 'string' ? errorRecord['message'].slice(0, 600) : '',
            ...(Number.isFinite(Number(errorRecord['status']))
              ? { status: Math.round(Number(errorRecord['status'])) }
              : {}),
            ...(Number.isFinite(Number(errorRecord['retryAfterMs']))
              ? { retryAfterMs: Math.round(Number(errorRecord['retryAfterMs'])) }
              : {})
          }
        }
        break
      }

      case 'retry.cleared': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (target) delete target.retry
        break
      }

      case 'continue.started': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target) {
          skipped += 1
          break
        }
        target.continuations = (target.continuations ?? 0) + 1
        break
      }

      case 'tool.called': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target) {
          skipped += 1
          break
        }
        target.toolCalls.push({
          id: typeof data['id'] === 'string' ? data['id'] : `call-${event.seq}`,
          name: typeof data['name'] === 'string' ? data['name'] : 'unknown',
          arguments: typeof data['arguments'] === 'string' ? data['arguments'] : '{}'
        })
        break
      }

      case 'tool.result': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target) {
          skipped += 1
          break
        }
        target.toolResults.push({
          toolCallId: typeof data['toolCallId'] === 'string' ? data['toolCallId'] : '',
          name: typeof data['name'] === 'string' ? data['name'] : 'unknown',
          ok: data['ok'] === true,
          content: typeof data['content'] === 'string' ? data['content'].slice(0, 20_000) : ''
        })
        break
      }

      case 'step.ended': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (!target) {
          skipped += 1
          break
        }
        if (typeof data['finishReason'] === 'string' || data['finishReason'] === null) {
          target.finishReason = data['finishReason'] as string | null
        }
        if (data['usage']) target.usage = data['usage']
        break
      }

      case 'assistant.completed': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (target) {
          if (typeof data['finishReason'] === 'string' || data['finishReason'] === null) {
            target.finishReason = data['finishReason'] as string | null
          }
          delete target.retry
        }
        break
      }

      case 'assistant.failed': {
        const target = messageId ? byId.get(messageId) : currentAssistant()
        if (target) {
          target.finishReason = 'error'
          delete target.retry
        }
        break
      }

      default:
        unknownTypes.add(event.type)
        break
    }
  }

  return { messages, lastSeq, skipped, unknownTypes: [...unknownTypes] }
}

/**
 * Oturumun günlüğünü okuyup projeksiyonunu döndürür.
 * `syncSession` IPC'sinin arkasındaki iş.
 */
export async function projectStoredSession(sessionId: string): Promise<ProjectedSession> {
  const { bySession, skipped } = await readEvents()
  const events = bySession.get(sessionId) ?? []
  const projected = projectSession(events)
  seedSeq(sessionId, projected.lastSeq)
  return {
    ...projected,
    skipped: projected.skipped + skipped
  }
}
