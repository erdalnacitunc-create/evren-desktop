import type { Session, StoredMessage, StoredRetry } from '../shared/types'

/**
 * Oturum deposu göçü.
 *
 * `sessions.json` diskte kalıcıdır; şema büyüdükçe eski dosyaların
 * **bozulmadan** yüklenmesi gerekir. OpenCode bunu SQLite göçleriyle yapar;
 * bizim dosya tabanlı depomuzda aynı işi sürüm numarası + normalize adımı
 * yapar.
 *
 * Kurallar:
 *  - Bilinmeyen/eski alanlar atılmaz, olduğu gibi korunur (ileri uyumluluk).
 *  - Eksik zorunlu alanlar güvenli varsayılanla doldurulur.
 *  - Bozuk kayıt tüm dosyayı düşürmez; yalnızca o kayıt atlanır ve loglanır.
 *  - Göç idempotenttir: aynı dosya iki kez göçerse sonuç değişmez.
 */

/** Disk biçiminin sürümü. Yeni alan eklendiğinde artırılır. */
export const STORE_VERSION = 2

export interface StoreFile {
  version?: number
  sessions: Session[]
}

export interface MigrationReport {
  fromVersion: number
  toVersion: number
  sessions: number
  messages: number
  /** Onarılan/atlanan kayıt sayısı. */
  repaired: number
  skipped: number
  notes: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Retry alanını doğrular. Geçersizse `undefined` döner (alan sessizce atılmaz, raporlanır). */
export function normalizeRetry(input: unknown, report?: { repaired: number }): StoredRetry | undefined {
  if (!isRecord(input)) return undefined
  const attempt = Number(input['attempt'])
  const at = Number(input['at'])
  if (!Number.isFinite(attempt) || attempt <= 0) {
    if (report) report.repaired += 1
    return undefined
  }
  if (!Number.isFinite(at) || at <= 0) {
    if (report) report.repaired += 1
    return undefined
  }
  const rawError = input['error']
  const errorRecord = isRecord(rawError) ? rawError : {}
  const type = typeof errorRecord['type'] === 'string' ? errorRecord['type'] : 'UnknownProvider'
  const message =
    typeof errorRecord['message'] === 'string' ? errorRecord['message'].slice(0, 600) : ''
  const statusValue = Number(errorRecord['status'])
  const retryAfterValue = Number(errorRecord['retryAfterMs'])

  const result: StoredRetry = {
    attempt: Math.round(attempt),
    at: Math.round(at),
    error: { type, message }
  }
  if (Number.isFinite(statusValue) && statusValue >= 100 && statusValue <= 599) {
    result.error.status = Math.round(statusValue)
  }
  if (Number.isFinite(retryAfterValue) && retryAfterValue >= 0) {
    result.error.retryAfterMs = Math.round(retryAfterValue)
  }
  return result
}

/**
 * Tek bir mesajı normalize eder.
 * `null` dönerse mesaj atlanır (kurtarılamaz).
 */
export function normalizeMessage(
  input: unknown,
  index: number,
  report: { repaired: number; skipped: number; notes: string[] }
): StoredMessage | null {
  if (!isRecord(input)) {
    report.skipped += 1
    report.notes.push(`mesaj #${index}: nesne değil`)
    return null
  }

  const role = input['role']
  if (role !== 'user' && role !== 'assistant') {
    report.skipped += 1
    report.notes.push(`mesaj #${index}: geçersiz rol`)
    return null
  }

  const content = typeof input['content'] === 'string' ? input['content'] : ''
  const id = typeof input['id'] === 'string' && input['id'] ? input['id'] : `migrated-${index}`
  if (typeof input['content'] !== 'string') {
    report.repaired += 1
    report.notes.push(`mesaj #${index}: içerik onarıldı`)
  }

  const createdAt = Number(input['createdAt'])
  const message: StoredMessage = {
    id,
    role,
    content,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.round(createdAt) : Date.now()
  }

  if (typeof input['reasoning'] === 'string' && input['reasoning']) {
    message.reasoning = input['reasoning']
  }
  if (typeof input['requestId'] === 'string' && input['requestId']) {
    message.requestId = input['requestId']
  }
  if (input['finishReason'] === null || typeof input['finishReason'] === 'string') {
    message.finishReason = input['finishReason'] as string | null
  }
  if (isRecord(input['usage'])) {
    message.usage = input['usage'] as StoredMessage['usage']
  }

  // v2: kalıcı retry + continuations
  const retry = normalizeRetry(input['retry'], report)
  if (retry) message.retry = retry
  const continuations = Number(input['continuations'])
  if (Number.isFinite(continuations) && continuations > 0) {
    message.continuations = Math.round(continuations)
  }

  return message
}

/**
 * Depo dosyasını normalize eder.
 * Hem eski biçimi (dizi) hem yeni biçimi (`{ version, sessions }`) kabul eder.
 */
export function migrateStore(raw: unknown): { store: StoreFile; report: MigrationReport } {
  const report: MigrationReport = {
    fromVersion: 0,
    toVersion: STORE_VERSION,
    sessions: 0,
    messages: 0,
    repaired: 0,
    skipped: 0,
    notes: []
  }

  let list: unknown[] = []
  if (Array.isArray(raw)) {
    // v0/v1: doğrudan dizi
    report.fromVersion = 1
    list = raw
    report.notes.push('dizi biçimi (v1) algılandı')
  } else if (isRecord(raw) && Array.isArray(raw['sessions'])) {
    const version = Number(raw['version'])
    report.fromVersion = Number.isFinite(version) && version > 0 ? Math.round(version) : 1
    list = raw['sessions'] as unknown[]
  } else if (isRecord(raw)) {
    report.fromVersion = 1
    report.notes.push('bilinmeyen biçim; boş depo')
  }

  const sessions: Session[] = []
  for (const [index, item] of list.entries()) {
    if (!isRecord(item)) {
      report.skipped += 1
      report.notes.push(`oturum #${index}: nesne değil`)
      continue
    }
    const id = typeof item['id'] === 'string' && item['id'] ? item['id'] : null
    if (!id) {
      report.skipped += 1
      report.notes.push(`oturum #${index}: kimlik yok`)
      continue
    }

    const rawMessages = Array.isArray(item['messages']) ? (item['messages'] as unknown[]) : []
    const messages: StoredMessage[] = []
    for (const [messageIndex, rawMessage] of rawMessages.entries()) {
      const message = normalizeMessage(rawMessage, messageIndex, report)
      if (message) messages.push(message)
    }

    const createdAt = Number(item['createdAt'])
    const updatedAt = Number(item['updatedAt'])
    const session: Session = {
      id,
      title: typeof item['title'] === 'string' && item['title'] ? item['title'] : 'Yeni sohbet',
      modelId: typeof item['modelId'] === 'string' ? item['modelId'] : '',
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.round(createdAt) : Date.now(),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.round(updatedAt) : Date.now(),
      messages
    }

    // İsteğe bağlı alanlar: varsa korunur.
    for (const key of [
      'summary',
      'summaryMessageCount',
      'todos',
      'workspacePath',
      'workspaceTemporary',
      'lastMemoryLearnCount'
    ] as const) {
      if (item[key] !== undefined) {
        ;(session as unknown as Record<string, unknown>)[key] = item[key]
      }
    }

    sessions.push(session)
    report.sessions += 1
    report.messages += messages.length
  }

  return { store: { version: STORE_VERSION, sessions }, report }
}

/** Diske yazılacak JSON. Göç sonrası her zaman yeni biçim. */
export function serializeStore(sessions: Session[]): string {
  return JSON.stringify({ version: STORE_VERSION, sessions }, null, 2)
}
