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

/**
 * Ajan işçisi — ayrı süreçte (utilityProcess) çalışan giriş noktası.
 *
 * Taşıma: `process.parentPort` üzerinden NDJSON satırları.
 * Bu adımda işçi:
 *  - ping/pong ile canlılık bildirir
 *  - oturum deposunu **uzak** olarak kullanır (ana süreç tek yazar)
 *  - oturum isteklerini ana sürece iletir
 * Gerçek ajan döngüsü sonraki adımda devralınacak.
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
  requests: 0
}

const rpc = new RpcEndpoint({
  send: (line) => parentPort!.postMessage(line),
  defaultTimeoutMs: 30_000,
  log: (level, message) => {
    if (level === 'warn') process.stderr.write(`[agent-worker] ${message}\n`)
  },
  handler: async (message) => {
    if (message.method === 'ping') {
      return {
        pid: process.pid,
        uptimeMs: Date.now() - state.startedAt,
        requests: state.requests,
        protocol: PROTOCOL_VERSION
      }
    }
    if (message.method === 'shutdown') {
      setImmediate(() => process.exit(0))
      return { ok: true }
    }
    if (message.method === 'session.probe') {
      // Oturum deposunun gerçekten uzak olduğunu kanıtlar.
      const repo = await (await import('../sessionRepository')).sessions()
      const list = await repo.list()
      return { ok: true, sessions: list.length }
    }
    throw Object.assign(new Error(`Bilinmeyen yöntem: ${String(message.method)}`), {
      code: 'unknown-method'
    })
  }
})

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
export { createMessage }