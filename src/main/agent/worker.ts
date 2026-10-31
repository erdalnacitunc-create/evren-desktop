import {
  PROTOCOL_VERSION,
  createMessage,
  type TransportMessage
} from '../transport/protocol'
import { RpcEndpoint } from '../transport/rpc'
import { createRemoteSessionRepository } from '../transport/remoteSessionRepository'
import {
  resetSessionRepository,
  setSessionRepository
} from '../sessionRepository'
import { runAgent } from './loop'
import { runWithWorkspace } from '../workspace'
import type { AppSettings, ChatEvent, ChatRequest } from '../../shared/types'

/**
 * Ajan işçisi — ayrı süreçte (utilityProcess) çalışan giriş noktası.
 *
 * Taşıma: `process.parentPort` üzerinden NDJSON satırları.
 *
 * İşçi Electron API'lerine sahip değildir (`app`, `safeStorage` yok). Bu
 * yüzden:
 *  - ayarlar ve API anahtarı `agent.run` yüküyle ana süreçten gelir
 *  - oturum deposu uzaktır (ana süreç tek yazar)
 *  - beceri/MCP/eklenti yetenekleri kapalıdır (ana süreçte yaşarlar)
 */

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

if (!parentPort) {
  process.stderr.write('[agent-worker] parentPort yok; utilityProcess ile başlatılmalı\n')
  process.exit(2)
}

const state = {
  startedAt: Date.now(),
  requests: 0,
  running: 0
}

/** Çalışan ajan isteklerinin iptal denetleyicileri. */
const controllers = new Map<string, AbortController>()

interface AgentRunPayload {
  requestId: string
  baseUrl: string
  apiKey: string
  payload: ChatRequest
  settings: AppSettings
  workspaceRoot: string | null
}

const rpc = new RpcEndpoint({
  send: (line) => parentPort!.postMessage(line),
  defaultTimeoutMs: 30_000,
  log: (level, message) => {
    if (level === 'warn') process.stderr.write(`[agent-worker] ${message}\n`)
  },
  handler: async (message) => {
    const method = String(message.method ?? '')

    if (method === 'ping') {
      return {
        pid: process.pid,
        uptimeMs: Date.now() - state.startedAt,
        requests: state.requests,
        running: state.running,
        protocol: PROTOCOL_VERSION
      }
    }

    if (method === 'shutdown') {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      setImmediate(() => process.exit(0))
      return { ok: true }
    }

    if (method === 'session.probe') {
      const repo = await (await import('../sessionRepository')).sessions()
      const list = await repo.list()
      return { ok: true, sessions: list.length }
    }

    if (method === 'agent.run') {
      const input = message.payload as AgentRunPayload
      return runInWorker(input)
    }

    if (method === 'agent.cancel') {
      const { requestId } = (message.payload ?? {}) as { requestId?: string }
      const controller = requestId ? controllers.get(requestId) : undefined
      if (!controller) return { ok: false, reason: 'not-found' }
      controller.abort()
      return { ok: true }
    }

    throw Object.assign(new Error(`Bilinmeyen yöntem: ${method}`), {
      code: 'unknown-method'
    })
  }
})

/**
 * Ajanı işçide çalıştırır.
 * `agent.run` isteği ajan bitene kadar bekler; olaylar ayrı `event`
 * mesajlarıyla akar (istek yanıtı yalnızca bitişi bildirir).
 */
async function runInWorker(input: AgentRunPayload): Promise<{ ok: boolean; error?: string }> {
  if (!input?.requestId) {
    throw Object.assign(new Error('requestId gerekli'), { code: 'bad-input' })
  }
  if (controllers.has(input.requestId)) {
    return { ok: false, error: 'Bu istek zaten çalışıyor' }
  }

  state.requests += 1
  state.running += 1
  const controller = new AbortController()
  controllers.set(input.requestId, controller)

  const sink = {
    emit(event: ChatEvent): void {
      rpc.emit(createMessage('event', input.requestId, { payload: event }))
    }
  }

  try {
    await runWithWorkspace(input.workspaceRoot, () =>
      runAgent({
        requestId: input.requestId,
        // İşçide pencere yok; olaylar taşıyıcıdan çıkar.
        webContentsId: -1,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        payload: input.payload,
        controller,
        sink,
        settings: input.settings,
        hostlessCapabilities: true,
        workspaceRoot: input.workspaceRoot
      })
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    controllers.delete(input.requestId)
    state.running -= 1
  }
}

// İşçide oturum deposu uzaktır: ana süreç tek yazardır.
setSessionRepository(createRemoteSessionRepository(rpc))

process.on('exit', () => resetSessionRepository())

parentPort.on('message', (event) => {
  const data = event?.data
  if (typeof data !== 'string') {
    parentPort!.postMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        kind: 'error',
        id: 'unknown',
        payload: { message: 'Çerçeve string değil', code: 'bad-frame' }
      }) + '\n'
    )
    return
  }
  for (const line of data.split('\n')) rpc.handleLine(line)
})

process.on('disconnect', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

export type { TransportMessage }
