import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Session, SessionSummary, StoredMessage, TodoItem } from '../shared/types'

let cache: Session[] | null = null
let writeChain: Promise<void> = Promise.resolve()

function storeFile(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

async function load(): Promise<Session[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(storeFile(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    cache = Array.isArray(parsed) ? (parsed as Session[]) : []
  } catch {
    cache = []
  }
  return cache
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache ?? [], null, 2)
  const target = storeFile()
  const temp = `${target}.tmp`
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await fs.writeFile(temp, snapshot, 'utf8')
      await fs.rename(temp, target)
    })
    .catch((error) => {
      console.error('Oturumlar kaydedilemedi:', error)
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
