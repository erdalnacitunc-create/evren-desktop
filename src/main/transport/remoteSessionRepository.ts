import type { Session, SessionSummary, StoredMessage, TodoItem } from '../../shared/types'
import type { SessionRepository } from '../sessionRepository'
import type { RpcEndpoint } from '../transport/rpc'

/**
 * Uzak oturum deposu: işçi tarafında çalışır, istekleri ana sürece yollar.
 *
 * Ajan süreci `sessions.json`'a doğrudan erişmez (tek yazar ilkesi). Böylece
 * iki süreç aynı dosyaya yazıp birbirinin değişikliğini ezmez.
 */

interface RemoteError {
  message?: string
  code?: string
}

export function createRemoteSessionRepository(rpc: RpcEndpoint): SessionRepository {
  const call = async <T>(method: string, args: unknown[]): Promise<T> => {
    const message = await rpc.request(`session.${method}`, args)
    if (message.kind === 'error') {
      const payload = (message.payload ?? {}) as RemoteError
      const error = new Error(payload.message ?? `Uzak hata: ${method}`) as Error & {
        code?: string
      }
      error.code = payload.code
      throw error
    }
    return message.payload as T
  }

  return {
    list: () => call<SessionSummary[]>('list', []),
    search: (query: string) => call<SessionSummary[]>('search', [query]),
    get: (id: string) => call<Session | null>('get', [id]),
    create: (modelId: string) => call<Session>('create', [modelId]),
    appendMessage: (sessionId: string, message: StoredMessage) =>
      call<Session | null>('appendMessage', [sessionId, message]),
    patch: (sessionId: string, patch: Partial<Session>) =>
      call<Session | null>('patch', [sessionId, patch]),
    setModel: (sessionId: string, modelId: string) =>
      call<Session | null>('setModel', [sessionId, modelId]),
    setTodos: (sessionId: string, todos: TodoItem[]) =>
      call<Session | null>('setTodos', [sessionId, todos]),
    rename: (sessionId: string, title: string) =>
      call<Session | null>('rename', [sessionId, title]),
    remove: (sessionId: string) => call<boolean>('remove', [sessionId])
  }
}

/**
 * Ana süreç tarafı: `session.*` yöntemlerini yerel depoya bağlar.
 * İşçiden gelen payload `[arg1, arg2, ...]` biçimindedir.
 */
export function createSessionHandler(
  repository: SessionRepository
): (method: string, args: unknown[]) => Promise<unknown> {
  return async (method: string, args: unknown[]): Promise<unknown> => {
    switch (method) {
      case 'list':
        return repository.list()
      case 'search':
        return repository.search(String(args[0] ?? ''))
      case 'get':
        return repository.get(String(args[0] ?? ''))
      case 'create':
        return repository.create(String(args[0] ?? ''))
      case 'appendMessage':
        return repository.appendMessage(
          String(args[0] ?? ''),
          args[1] as StoredMessage
        )
      case 'patch':
        return repository.patch(String(args[0] ?? ''), (args[1] ?? {}) as Partial<Session>)
      case 'setModel':
        return repository.setModel(String(args[0] ?? ''), String(args[1] ?? ''))
      case 'setTodos':
        return repository.setTodos(String(args[0] ?? ''), (args[1] ?? []) as TodoItem[])
      case 'rename':
        return repository.rename(String(args[0] ?? ''), String(args[1] ?? ''))
      case 'remove':
        return repository.remove(String(args[0] ?? ''))
      default:
        throw Object.assign(new Error(`Bilinmeyen oturum yöntemi: ${method}`), {
          code: 'unknown-method'
        })
    }
  }
}
