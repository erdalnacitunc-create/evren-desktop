/// <reference types="node" />
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  resetSessionRepository,
  sessions,
  setSessionRepository,
  type SessionRepository
} from '../src/main/sessionRepository'
import { createTools } from '../src/main/agent/tools'
import type { Session, SessionSummary, StoredMessage, TodoItem } from '../src/shared/types'

/**
 * Oturum deposu arayüzü testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/session-repository-test.ts
 *
 * İki şeyi kanıtlar:
 *  1. Arayüz tam: yerel olmayan bir uygulama takılabiliyor.
 *  2. Ajan yolu gerçekten arayüzden geçiyor: fake depo takıldığında
 *     oturumlar diske değil ona yazılıyor.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Bellekte çalışan, hiç diske yazmayan uygulama (gelecekteki uzak depo yerine). */
function createFakeRepository(): SessionRepository & {
  sessions: Map<string, Session>
  calls: string[]
} {
  const store = new Map<string, Session>()
  const calls: string[] = []
  let counter = 0

  const summary = (session: Session): SessionSummary => ({
    id: session.id,
    title: session.title,
    modelId: session.modelId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: session.messages[session.messages.length - 1]?.content.slice(0, 120) ?? ''
  })

  return {
    sessions: store,
    calls,
    async list() {
      calls.push('list')
      return [...store.values()].map(summary)
    },
    async search(query: string) {
      calls.push('search')
      return [...store.values()]
        .filter((session) => session.title.includes(query))
        .map(summary)
    },
    async get(id: string) {
      calls.push('get')
      return store.get(id) ?? null
    },
    async create(modelId: string) {
      calls.push('create')
      const now = Date.now()
      counter += 1
      const session: Session = {
        id: `fake-${counter}`,
        title: 'Yeni sohbet',
        modelId,
        createdAt: now,
        updatedAt: now,
        messages: []
      }
      store.set(session.id, session)
      return session
    },
    async appendMessage(sessionId: string, message: StoredMessage) {
      calls.push('appendMessage')
      const session = store.get(sessionId)
      if (!session) return null
      session.messages.push(message)
      session.updatedAt = Date.now()
      return session
    },
    async patch(sessionId: string, patch: Partial<Session>) {
      calls.push('patch')
      const session = store.get(sessionId)
      if (!session) return null
      Object.assign(session, patch)
      return session
    },
    async setModel(sessionId: string, modelId: string) {
      calls.push('setModel')
      const session = store.get(sessionId)
      if (!session) return null
      session.modelId = modelId
      return session
    },
    async setTodos(sessionId: string, todos: TodoItem[]) {
      calls.push('setTodos')
      const session = store.get(sessionId)
      if (!session) return null
      session.todos = todos
      return session
    },
    async rename(sessionId: string, title: string) {
      calls.push('rename')
      const session = store.get(sessionId)
      if (!session) return null
      session.title = title
      return session
    },
    async remove(sessionId: string) {
      calls.push('remove')
      return store.delete(sessionId)
    }
  }
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'repo-ws')
  const sessionsFile = join(process.env.EVREN_TEST_DATA as string, 'sessions.json')

  // ===== 1) varsayılan: yerel depo =====
  resetSessionRepository()
  {
    const repo = await sessions()
    check('varsayılan depo nesne', typeof repo?.get, 'function')
    check('on arayüz metodları var', typeof repo?.appendMessage, 'function')
    check('arayüz 10 metot', Object.keys(repo ?? {}).length >= 10, true)
  }

  // ===== 2) fake depo takılır =====
  const fake = createFakeRepository()
  setSessionRepository(fake)
  {
    const repo = await sessions()
    check('fake depo etkin', repo === fake, true)
    const created = await repo.create('model-x')
    check('fake üzerinden oluşturuldu', fake.sessions.size, 1)
    check('dosyaya yazılmadı', existsSync(sessionsFile), false)
    await repo.rename(created.id, 'Başlık')
    check('rename fake üzerinde', fake.sessions.get(created.id)?.title, 'Başlık')
  }

  // ===== 3) ajan aracı arayüzden geçiyor =====
  {
    const session = await fake.create('test-model')
    await fake.rename(session.id, 'Fake oturum')
    const tools = createTools({
      browser: false,
      computer: false,
      workspace: { root: base, sessionId: session.id }
    })
    const sessionTool = tools.get('session')
    check('session aracı var', !!sessionTool, true)

    fake.calls.length = 0
    const listed = await sessionTool!.execute(
      { action: 'list' },
      { requestId: 'r1', sessionId: session.id, send: () => undefined }
    )
    check('liste fake üzerinden', fake.calls.includes('list'), true)
    check('liste oturumu içerir', listed.content.includes('Fake oturum'), true)

    fake.calls.length = 0
    const searched = await sessionTool!.execute(
      { action: 'search', query: 'Fake' },
      { requestId: 'r1', sessionId: session.id, send: () => undefined }
    )
    check('arama fake üzerinden', fake.calls.includes('search'), true)
    check('arama sonucu var', searched.content.includes('Fake oturum'), true)

    fake.calls.length = 0
    await sessionTool!.execute(
      { action: 'rename', title: 'Yeni ad' },
      { requestId: 'r1', sessionId: session.id, send: () => undefined }
    )
    check('rename fake üzerinden', fake.calls.includes('rename'), true)
    check('başlık fake depoda değişti', fake.sessions.get(session.id)?.title, 'Yeni ad')
    check('diske yazılmadı', existsSync(sessionsFile), false)
  }

  // ===== 4) yerel depoya dönüş =====
  resetSessionRepository()
  {
    const repo = await sessions()
    check('yerel depoya döndü', repo === fake, false)
    const created = await repo.create('model-local')
    check('yerel depo diske yazdı', existsSync(sessionsFile), true)
    await repo.remove(created.id)
    await sleep(50)
  }

  console.log(`TOTAL=14 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
