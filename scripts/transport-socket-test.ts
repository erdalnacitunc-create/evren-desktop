/// <reference types="node" />
import { createServer, connect, type Server, type Socket } from 'net'
import {
  authorizeToken,
  createFramer,
  createMessage,
  decodeMessage,
  encodeMessage,
  generateToken,
  type TransportMessage
} from '../src/main/transport/protocol'
import { randomBytes } from 'crypto'

/**
 * Taşıyıcı protokolünün gerçek soket üzerinden testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/transport-socket-test.ts
 *
 * Süreç ayrımında kullanılacak çerçeveleme + kimlik doğrulama akışını
 * gerçek bir TCP soketinde sınar (sunucu ve istemci aynı süreçte, ayrı
 * bağlantılarda).
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const TOKEN = generateToken(randomBytes)

interface Session {
  socket: Socket
  framer: ReturnType<typeof createFramer>
  authorized: boolean
  received: TransportMessage[]
}

function attach(socket: Socket, sessions: Set<Session>): Session {
  const session: Session = {
    socket,
    framer: createFramer(),
    authorized: false,
    received: []
  }
  sessions.add(session)
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    for (const line of session.framer.push(chunk)) {
      const decoded = decodeMessage(line)
      if (!decoded.ok) {
        socket.write(encodeMessage(createMessage('error', 'unknown', { payload: decoded.error })))
        continue
      }
      const message = decoded.message

      // İlk mesaj kimlik doğrulama taşır.
      if (!session.authorized) {
        const verdict = authorizeToken(TOKEN, {
          authorization: String((message.payload as { authorization?: string })?.authorization ?? '')
        })
        if (!verdict.ok) {
          socket.write(
            encodeMessage(
              createMessage('error', message.id, { payload: verdict.error })
            )
          )
          socket.end()
          continue
        }
        session.authorized = true
        socket.write(encodeMessage(createMessage('response', message.id, { payload: { ok: true } })))
        continue
      }

      session.received.push(message)
      if (message.kind === 'request') {
        if (message.method === 'echo') {
          socket.write(
            encodeMessage(createMessage('response', message.id, { payload: message.payload }))
          )
        } else if (message.method === 'eventStream') {
          for (const part of ['bir', 'iki', 'üç']) {
            socket.write(
              encodeMessage(
                createMessage('event', message.id, { payload: { type: 'content', text: part } })
              )
            )
          }
          socket.write(encodeMessage(createMessage('response', message.id, { payload: { done: true } })))
        }
      }
    }
  })
  socket.on('close', () => sessions.delete(session))
  return session
}

/** Bağlan, kimlik doğrula, mesaj gönder; yanıtları döndür. */
function runClient(
  port: number,
  token: string | null,
  script: (send: (message: TransportMessage) => void) => void
): Promise<{ responses: TransportMessage[]; events: TransportMessage[]; errors: TransportMessage[]; closed: boolean }> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    const framer = createFramer()
    const responses: TransportMessage[] = []
    const events: TransportMessage[] = []
    const errors: TransportMessage[] = []
    let closed = false

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(
        encodeMessage(
          createMessage('request', 'auth', {
            method: 'auth',
            payload: { authorization: token ? `Bearer ${token}` : '' }
          })
        )
      )
    })
    socket.on('data', (chunk: string) => {
      for (const line of framer.push(chunk)) {
        const decoded = decodeMessage(line)
        if (!decoded.ok) continue
        const message = decoded.message
        if (message.kind === 'response') responses.push(message)
        else if (message.kind === 'event') events.push(message)
        else if (message.kind === 'error') errors.push(message)
      }
      // Yetkilendirme yanıtı geldiyse betiği çalıştır.
      if (responses.length === 1 && !socket.destroyed) {
        const alreadySent = (socket as unknown as { __scripted?: boolean }).__scripted
        if (!alreadySent) {
          ;(socket as unknown as { __scripted?: boolean }).__scripted = true
          script((message) => socket.write(encodeMessage(message)))
        }
      }
    })
    socket.on('close', () => {
      closed = true
    })

    setTimeout(() => {
      if (!socket.destroyed) socket.end()
    }, 700)
    socket.on('close', () => {
      setTimeout(() => resolve({ responses, events, errors, closed }), 20)
    })
  })
}

async function listen(): Promise<{ server: Server; port: number; sessions: Set<Session> }> {
  const sessions = new Set<Session>()
  const server = createServer((socket) => attach(socket, sessions))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, port, sessions }
}

void (async () => {
  const { server, port, sessions } = await listen()

  // ===== 1) doğru token ile istek/yanıt =====
  {
    const result = await runClient(port, TOKEN, (send) => {
      send(createMessage('request', 'req-1', { method: 'echo', payload: { selam: 'dünya' } }))
    })
    check('kimlik doğrulandı', result.responses[0]?.payload, { ok: true })
    check('echo yanıtı geldi', result.responses[1]?.payload, { selam: 'dünya' })
    check('yanıt kimliği eşleşti', result.responses[1]?.id, 'req-1')
  }

  // ===== 2) yanlış token reddedilir =====
  {
    const result = await runClient(port, 'yanlis-token', () => undefined)
    check('yanlış token hatası', result.errors[0]?.payload, { message: 'Geçersiz token', code: 'invalid' })
    check('bağlantı kapatıldı', result.closed, true)
    check('yanlış tokende istek işlenmez', result.responses.length, 0)
  }

  // ===== 3) token yok =====
  {
    const result = await runClient(port, null, () => undefined)
    check(
      'token yok hatası',
      result.errors[0]?.payload,
      { message: 'Kimlik doğrulama başlığı yok', code: 'missing' }
    )
  }

  // ===== 4) akış: birden çok olay + tek yanıt =====
  {
    const result = await runClient(port, TOKEN, (send) => {
      send(createMessage('request', 'stream-1', { method: 'eventStream', payload: {} }))
    })
    check('üç olay geldi', result.events.length, 3)
    check(
      'olay metinleri sırayla',
      result.events.map((event) => (event.payload as { text: string }).text),
      ['bir', 'iki', 'üç']
    )
    check('olaylar aynı kimlikte', result.events.every((event) => event.id === 'stream-1'), true)
    check('akış sonu yanıtı', result.responses[1]?.payload, { done: true })
  }

  // ===== 5) iki istemci birbirinden bağımsız =====
  {
    const [first, second] = await Promise.all([
      runClient(port, TOKEN, (send) => {
        send(createMessage('request', 'c1', { method: 'echo', payload: { n: 1 } }))
      }),
      runClient(port, TOKEN, (send) => {
        send(createMessage('request', 'c2', { method: 'echo', payload: { n: 2 } }))
      })
    ])
    check('birinci istemci kendi yükünü aldı', first.responses[1]?.payload, { n: 1 })
    check('ikinci istemci kendi yükünü aldı', second.responses[1]?.payload, { n: 2 })
    check('kimlikler karışmadı', [first.responses[1]?.id, second.responses[1]?.id], ['c1', 'c2'])
  }

  // ===== 6) büyük yük parçalanması =====
  {
    const large = { text: 'x'.repeat(200_000) }
    const result = await runClient(port, TOKEN, (send) => {
      send(createMessage('request', 'big', { method: 'echo', payload: large }))
    })
    const payload = result.responses[1]?.payload as { text: string } | undefined
    check('büyük yük eksiksiz döndü', payload?.text.length, 200_000)
  }

  server.close()
  for (const session of sessions) session.socket.destroy()

  console.log(`TOTAL=15 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})()
