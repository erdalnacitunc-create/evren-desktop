import type { Session, SessionSummary, StoredMessage, TodoItem } from '../shared/types'
import { createLogger } from './logger'

/**
 * Oturum deposu arayüzü.
 *
 * Bugün tek uygulama yerel JSON deposu (`sessionStore.ts`). Süreç ayrımında
 * ajan süreci bu arayüzün uzak bir uygulamasını kullanacak; ajan kodu hangi
 * uygulamanın bağlı olduğunu bilmez.
 *
 * Arayüz bilinçli olarak `sessionStore`'un mevcut imzalarını izler; böylece
 * geçiş davranış değişikliği üretmez.
 */

export interface SessionRepository {
  list(): Promise<SessionSummary[]>
  search(query: string): Promise<SessionSummary[]>
  get(id: string): Promise<Session | null>
  create(modelId: string): Promise<Session>
  appendMessage(sessionId: string, message: StoredMessage): Promise<Session | null>
  patch(sessionId: string, patch: Partial<Session>): Promise<Session | null>
  setModel(sessionId: string, modelId: string): Promise<Session | null>
  setTodos(sessionId: string, todos: TodoItem[]): Promise<Session | null>
  rename(sessionId: string, title: string): Promise<Session | null>
  remove(sessionId: string): Promise<boolean>
}

const log = createLogger('sessionRepository')

let active: SessionRepository | null = null

/**
 * Etkin depoyu döndürür.
 * Henüz biri atanmadıysa yerel depo tembel yüklenir (döngüsel import
 * yaratmamak için dinamik).
 */
export async function sessions(): Promise<SessionRepository> {
  if (active) return active
  const local = await import('./sessionStore')
  active = local.localSessionRepository
  return active
}

/**
 * Etkin depoyu değiştirir. Testler ve gelecekteki uzak uygulama içindir.
 * `null` vermek yerel depoya döner.
 */
export function setSessionRepository(repository: SessionRepository | null): void {
  active = repository
  log.debug(repository ? 'Oturum deposu değiştirildi' : 'Yerel oturum deposuna dönüldü')
}

/** Testler için: yerel depoya dön. */
export function resetSessionRepository(): void {
  active = null
}
