import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Session, SessionSummary, StoredMessage, TodoItem } from '../shared/types'
import type { SessionRepository } from './sessionRepository'
import { createLogger } from './logger'
import { STORE_VERSION, migrateStore, serializeStore } from './sessionMigration'
import { appendSessionEvent, nextSeq } from './sessionEvents'

const log = createLogger('sessionStore')

let cache: Session[] | null = null
let writeChain: Promise<void> = Promise.resolve()

function storeFile(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

/**
 * Diskteki dosyayı yükler ve göçten geçirir.
 *
 * Eski sürümler dosyayı düz dizi olarak yazıyordu; yeni biçim
 * version + sessions nesnesidir. Göç her iki biçimi de okur, eksik alanları
 * onarır ve bozuk kayıtları atlar (tüm dosyayı düşürmez).
 */
async function load(): Promise<Session[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(storeFile(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const { store, report } = migrateStore(parsed)
    cache = store.sessions
    if (report.skipped > 0 || report.repaired > 0 || report.fromVersion !== STORE_VERSION) {
      log.info(
        `Oturum deposu göçü: v${report.fromVersion} → v${report.toVersion} · ` +
          `${report.sessions} oturum, ${report.messages} mesaj, ` +
          `${report.repaired} onarım, ${report.skipped} atlandı`
      )
      for (const note of report.notes.slice(0, 10)) log.info(`göç: ${note}`)
      // Göç sonrası yeni biçimde geri yaz (idempotent).
      if (report.fromVersion !== STORE_VERSION) void persist()
    }
  } catch (error) {
    log.warn('Oturum dosyası okunamadı:', error)
    cache = []
  }
  return cache
}

function persist(): Promise<void> {
  const snapshot = serializeStore(cache ?? [])
  const target = storeFile()
  const temp = `${target}.tmp`
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await fs.writeFile(temp, snapshot, 'utf8')
      await fs.rename(temp, target)
    })
    .catch((error) => {
      log.error('Oturumlar kaydedilemedi:', error)
    })
  return writeChain
}

function summarize(session: Session): SessionSummary {
  const firstUser = session.messages.find((m) => m.role === 'user')?.content ?? ''
  const last = session.messages[session.messages.length - 1]?.content ?? ''
  return {
    id: session.id,
    title: session.title,
    modelId: session.modelId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: (last || firstUser).replace(/\s+/g, ' ').slice(0, 120)
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await load()
  return [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summarize)
}

export async function getSession(id: string): Promise<Session | null> {
  const sessions = await load()
  return sessions.find((s) => s.id === id) ?? null
}

export async function createSession(modelId: string): Promise<Session> {
  const sessions = await load()
  const now = Date.now()
  const session: Session = {
    id: crypto.randomUUID(),
    title: 'Yeni sohbet',
    modelId,
    createdAt: now,
    updatedAt: now,
    messages: []
  }
  sessions.push(session)
  await persist()
  void appendSessionEvent({
    seq: nextSeq(session.id),
    sessionId: session.id,
    type: 'session.created',
    data: { modelId }
  })
  return session
}

export async function appendMessage(
  sessionId: string,
  message: StoredMessage
): Promise<Session | null> {
  const sessions = await load()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return null

  session.messages.push(message)
  session.updatedAt = Date.now()
  if (message.role === 'user') {
    void appendSessionEvent({
      seq: nextSeq(sessionId),
      sessionId,
      type: 'user.message',
      data: { content: message.content, storedId: message.id }
    })
  }

  if (session.title === 'Yeni sohbet' && message.role === 'user') {
    const title = message.content.replace(/\s+/g, ' ').trim().slice(0, 48)
    if (title) session.title = title
  }

  await persist()
  return session
}

export async function patchSession(
  sessionId: string,
  patch: Partial<Session>
): Promise<Session | null> {
  const sessions = await load()
  const session = sessions.find((item) => item.id === sessionId)
  if (!session) return null
  Object.assign(session, patch)
  session.updatedAt = Date.now()
  await persist()
  return session
}

export async function setSessionModel(sessionId: string, modelId: string): Promise<Session | null> {
  const sessions = await load()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return null
  session.modelId = modelId
  session.updatedAt = Date.now()
  await persist()
  return session
}

export async function setSessionTodos(
  sessionId: string,
  todos: TodoItem[]
): Promise<Session | null> {
  const sessions = await load()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return null
  session.todos = todos.slice(0, 100)
  session.updatedAt = Date.now()
  await persist()
  return session
}

export async function renameSession(sessionId: string, title: string): Promise<Session | null> {
  const sessions = await load()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return null
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!trimmed) return session
  session.title = trimmed
  session.updatedAt = Date.now()
  await persist()
  void appendSessionEvent({
    seq: nextSeq(sessionId),
    sessionId,
    type: 'session.renamed',
    data: { title: trimmed }
  })
  return session
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const sessions = await load()
  const index = sessions.findIndex((s) => s.id === sessionId)
  if (index < 0) return false
  sessions.splice(index, 1)
  await persist()
  return true
}

export async function searchSessions(query: string): Promise<SessionSummary[]> {
  const q = query.trim().toLowerCase()
  if (!q) return listSessions()
  const sessions = await load()
  return sessions
    .filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true
      if (s.modelId.toLowerCase().includes(q)) return true
      return s.messages.some((m) => m.content.toLowerCase().includes(q))
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summarize)
}

/**
 * Yalnızca testler için: bellek içi önbelleği temizler, böylece bir sonraki
 * çağrı dosyadan yeniden okur ve kalıcılık doğrulanabilir.
 */
export async function __resetCacheForTests(): Promise<void> {
  await writeChain
  cache = null
  writeChain = Promise.resolve()
}

/** Yalnızca testler için: bekleyen yazmaların bitmesini bekler. */
export async function __flushWritesForTests(): Promise<void> {
  await writeChain
}

/**
 * Arayüz uygulaması. Süreç ayrımında bu nesnenin yerini uzak bir taşıyıcı alır.
 * Fonksiyonlar bilinçli olarak geç yüklenir (hoisted), böylece modül yüklenirken
 * döngüsel import sorunu çıkmaz.
 */
export const localSessionRepository: SessionRepository = {
  list: () => listSessions(),
  search: (query: string) => searchSessions(query),
  get: (id: string) => getSession(id),
  create: (modelId: string) => createSession(modelId),
  appendMessage: (sessionId: string, message: StoredMessage) => appendMessage(sessionId, message),
  patch: (sessionId: string, patch: Partial<Session>) => patchSession(sessionId, patch),
  setModel: (sessionId: string, modelId: string) => setSessionModel(sessionId, modelId),
  setTodos: (sessionId: string, todos: TodoItem[]) => setSessionTodos(sessionId, todos),
  rename: (sessionId: string, title: string) => renameSession(sessionId, title),
  remove: (sessionId: string) => deleteSession(sessionId)
}
