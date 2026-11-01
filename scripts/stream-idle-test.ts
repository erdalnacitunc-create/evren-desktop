/// <reference types="node" />
import { createServer } from 'http'
import { streamCompletion } from '../src/main/sse'

/**
 * Boşta kalan akış koruması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/stream-idle-test.ts
 *
 * Gerçek olay: iki paralel sekmede sağlayıcı bağlantıyı açtı ama hiç veri
 * göndermedi; istek sonsuza kadar bekledi (ne yanıt ne hata).
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

type Mode = 'silent' | 'slow-ok' | 'headers-then-silent'

function startServer(mode: Mode) {
  let requests = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      requests += 1
      if (mode === 'silent') {
        // Bağlantıyı aç, hiçbir şey gönderme.
        return
      }
      if (mode === 'headers-then-silent') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.flushHeaders()
        return
      }
      // slow-ok: eşik altında kalan aralıklarla parça gönder.
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      let index = 0
      const timer = setInterval(() => {
        if (index >= 4) {
          response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
          response.write('data: [DONE]\n\n')
          response.end()
          clearInterval(timer)
          return
        }
        response.write(sse({ choices: [{ delta: { content: `p${index} ` } }] }))
        index += 1
      }, 150)
    })
  })
  return new Promise<{ server: typeof server; port: number; count: () => number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        count: () => requests
      })
    })
  })
}

const run = (port: number, idleMs: number, retries: number[] = [], onRetry?: (info: { attempt: number; maxAttempts: number; reason: string }) => void) =>
  streamCompletion(
    `http://127.0.0.1:${port}`,
    'test',
    { model: 'x', messages: [{ role: 'user', content: 'x' }] },
    new AbortController().signal,
    () => undefined,
    {
      onRetry:
        onRetry ??
        ((info) => {
          retries.push(info.attempt)
        }),
      policy: { maxAttempts: 4, baseDelayMs: 20, maxDelayMs: 50, factor: 1 }
    }
  )

void (async () => {
  process.env['EVREN_STREAM_IDLE_MS'] = '400'

  // ===== 1) hiç veri gelmiyor: zaman aşımı + sınırlı deneme =====
  {
    const { server, port, count } = await startServer('silent')
    const retries: number[] = []
    const started = Date.now()
    let message = ''
    try {
      await run(port, 400, retries)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    const elapsed = Date.now() - started
    server.close()

    check('hata fırlatıldı (sonsuza kadar beklemez)', message.length > 0, true)
    check('hata mesajı boşta kalmayı açıklar', message.includes('veri göndermedi') || message.includes('durdu'), true)
    check('en fazla 2 deneme', count(), 2)
    check('tek yeniden deneme bildirildi', retries.length, 1)
    check('toplam süre sınırlı', elapsed < 5000, true)
  }

  // ===== 2) başlıklar geliyor, gövde gelmiyor =====
  {
    const { server, port, count } = await startServer('headers-then-silent')
    let message = ''
    try {
      await run(port, 400)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    server.close()

    check('başlık sonrası sessizlik yakalanır', message.length > 0, true)
    check('gövde sessizliğinde de deneme sınırı', count(), 2)
  }

  // ===== 3) yavaş ama düzenli akış tamamlanır =====
  {
    const { server, port } = await startServer('slow-ok')
    const retries: number[] = []
    let content = ''
    let error = ''
    try {
      const result = await run(port, 400, retries)
      content = result.content
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    server.close()

    check('yavaş akış hata vermez', error, '')
    check('yavaş akış tamamlanır', content, 'p0 p1 p2 p3 ')
    check('gereksiz deneme yok', retries.length, 0)
  }

  // ===== 4) iptal hâlâ çalışıyor =====
  {
    const { server, port } = await startServer('silent')
    const controller = new AbortController()
    const promise = streamCompletion(
      `http://127.0.0.1:${port}`,
      'test',
      { model: 'x', messages: [{ role: 'user', content: 'x' }] },
      controller.signal,
      () => undefined,
      { policy: { maxAttempts: 2, baseDelayMs: 20, maxDelayMs: 50, factor: 1 } }
    )
    setTimeout(() => controller.abort(), 100)
    let aborted = false
    try {
      await promise
    } catch (error) {
      aborted = (error as { name?: string }).name === 'AbortError' || controller.signal.aborted
    }
    server.close()
    check('kullanıcı iptali çalışır', aborted, true)
  }

  console.log(`TOTAL=13 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})()
