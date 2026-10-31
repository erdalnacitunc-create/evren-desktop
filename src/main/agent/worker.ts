import {
  PROTOCOL_VERSION,
  createMessage,
  decodeMessage,
  encodeMessage,
  type TransportMessage
} from '../transport/protocol'

/**
 * Ajan işçisi — ayrı süreçte (utilityProcess) çalışan giriş noktası.
 *
 * Bu adımda yalnızca yaşam döngüsü: süreç ayağa kalkıyor, ping'e pong
 * yanıtlıyor, protokol dışı mesajı reddediyor ve ebeveyn kapandığında
 * kendini sonlandırıyor. Gerçek ajan işi sonraki adımlarda eklenecek.
 *
 * Taşıma: `process.parentPort` üzerinden NDJSON satırları (structured clone
 * ile string taşınır). Böylece protokol katmanı soket ve süreç arasında aynı.
 */

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

if (!parentPort) {
  // Doğrudan `node` ile çalıştırıldıysa sessizce ölme; anlaşılır hata ver.
  process.stderr.write('[agent-worker] parentPort yok; utilityProcess ile başlatılmalı\n')
  process.exit(2)
}

/** İşçinin durumu (ileride istek tablosu buraya gelecek). */
const state = {
  startedAt: Date.now(),
  requests: 0,
  lastPingAt: null as number | null
}

function reply(message: TransportMessage): void {
  parentPort!.postMessage(encodeMessage(message))
}

function handle(message: TransportMessage): void {
  if (message.kind === 'ping') {
    state.lastPingAt = Date.now()
    reply(
      createMessage('pong', message.id, {
        payload: {
          pid: process.pid,
          uptimeMs: Date.now() - state.startedAt,
          requests: state.requests,
          protocol: PROTOCOL_VERSION
        }
      })
    )
    return
  }

  if (message.kind === 'request') {
    state.requests += 1
    if (message.method === 'ping') {
      state.lastPingAt = Date.now()
      reply(
        createMessage('response', message.id, {
          payload: {
            pid: process.pid,
            uptimeMs: Date.now() - state.startedAt,
            requests: state.requests,
            protocol: PROTOCOL_VERSION
          }
        })
      )
      return
    }
    if (message.method === 'shutdown') {
      reply(createMessage('response', message.id, { payload: { ok: true } }))
      setTimeout(() => process.exit(0), 10)
      return
    }
    reply(
      createMessage('error', message.id, {
        payload: { message: `Bilinmeyen yöntem: ${String(message.method)}`, code: 'unknown-method' }
      })
    )
    return
  }

  // cancel/event/response gibi türler bu adımda işlenmez.
  reply(
    createMessage('error', message.id, {
      payload: { message: `Bu tür işlenmiyor: ${message.kind}`, code: 'unsupported-kind' }
    })
  )
}

parentPort.on('message', (event) => {
  const data = event?.data
  if (typeof data !== 'string') {
    parentPort!.postMessage(
      encodeMessage(
        createMessage('error', 'unknown', {
          payload: { message: 'Çerçeve string değil', code: 'bad-frame' }
        })
      )
    )
    return
  }

  for (const line of data.split('\n')) {
    if (!line.trim()) continue
    const decoded = decodeMessage(line)
    if (!decoded.ok) {
      parentPort!.postMessage(
        encodeMessage(createMessage('error', 'unknown', { payload: decoded.error }))
      )
      continue
    }
    handle(decoded.message)
  }
})

// Ebeveyn bağlantısı kesilirse süreç kendini kapatmalı; aksi halde
// görünmez bir yetim süreç kalır.
process.on('disconnect', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
