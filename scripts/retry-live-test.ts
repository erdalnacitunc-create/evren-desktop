/// <reference types="node" />
import { createServer } from 'http'
import { streamCompletion } from '../src/main/sse'
import { RetryPolicy } from '../src/main/retry'

/**
 * Gerçek 503 senaryosu: sunucu önce 503 döner, sonra başarılı olur.
 * Kullanıcı "durdu" yerine kesintisiz yanıt görmeli.
 */
let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface Scenario {
  /** Kaç istek 503 dönsün. */
  failures: number
  /** Retry-After başlığı (saniye). */
  retryAfter?: string
  /** Kısmi içerik gönderip bağlantıyı kopsun mu? */
  breakMidStream?: boolean
}

function startServer(scenario: Scenario) {
  let count = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      count += 1
      if (count <= scenario.failures) {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (scenario.retryAfter) headers['retry-after'] = scenario.retryAfter
        response.writeHead(503, headers)
        response.end(JSON.stringify({ error: { message: 'model overloaded' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (scenario.breakMidStream) {
        response.write(sse({ choices: [{ delta: { content: 'YARIM ' } }] }))
        setTimeout(() => response.destroy(), 150)
        return
      }
      response.write(sse({ choices: [{ delta: { content: 'TAM ' } }] }))
      response.write(sse({ choices: [{ delta: { content: 'YANIT' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  return new Promise<{ server: typeof server; port: number; count: () => number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        count: () => count
      })
    })
  })
}

const run = (
  port: number,
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void,
  maxDelayMs = 200
) =>
  streamCompletion(
    `http://127.0.0.1:${port}`,
    'test',
    { model: 'x', messages: [{ role: 'user', content: 'x' }] },
    new AbortController().signal,
    () => undefined,
    { onRetry, policy: new RetryPolicy({ maxRetries: 3, random: () => 0.5 }) }
  )

void (async () => {
  // ===== 1) 503 → 503 → başarılı =====
  {
    const { server, port, count } = await startServer({ failures: 2 })
    const retries: number[] = []
    const started = Date.now()
    try {
      const result = await run(port, (info) => retries.push(info.attempt))
      check('iki hatadan sonra başarılı', result.content, 'TAM YANIT')
      check('iki yeniden deneme bildirildi', retries, [1, 2])
      check('sunucuya üç istek gitti', count(), 3)
      check('toplam süre politikaya uygun', Date.now() - started < 15_000, true)
    } catch (error) {
      check('503 sonrası başarı', `HATA: ${error instanceof Error ? error.message : error}`, 'TAM YANIT')
    }
    server.close()
  }

  // ===== 2) Retry-After'a uyulur =====
  {
    const { server, port } = await startServer({ failures: 1, retryAfter: '1' })
    const delays: number[] = []
    try {
      const result = await run(port, (info) => delays.push(info.delayMs), 5000)
      check('Retry-After sonrası başarı', result.content, 'TAM YANIT')
      check('Retry-After ile planın büyüğü kullanıldı', delays[0], 2000)
    } catch (error) {
      check('Retry-After senaryosu', String(error), 'TAM YANIT')
    }
    server.close()
  }

  // ===== 3) kalıcı 503: deneme sınırında durur =====
  {
    const { server, port, count } = await startServer({ failures: 99 })
    let message = ''
    let status: number | undefined
    try {
      await run(port, undefined)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
      status = (error as { status?: number }).status
    }
    check('en fazla 4 deneme', count(), 4)
    check('hata durumu 503', status, 503)
    check('hata mesajı sunucudan', message.includes('overloaded'), true)
    server.close()
  }

  // ===== 4) kısmi içerik sonrası kopma yeniden denenmez =====
  {
    const { server, port, count } = await startServer({ failures: 0, breakMidStream: true })
    let threw = false
    try {
      await run(port, undefined)
    } catch {
      threw = true
    }
    check('kopma hata verir', threw, true)
    check('kısmi içerikte tekrar denenmez', count(), 1)
    server.close()
  }

  // ===== 5) 401 yeniden denenmez =====
  {
    let count = 0
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        count += 1
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'geçersiz anahtar' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    let status: number | undefined
    try {
      await run(port, undefined)
    } catch (error) {
      status = (error as { status?: number }).status
    }
    check('401 durumu', status, 401)
    check('401 tek istek', count, 1)
    server.close()
  }


  console.log(`TOTAL=13 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})()
