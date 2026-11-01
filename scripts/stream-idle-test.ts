/// <reference types="node" />
import { createServer } from 'http'
import { streamCompletion } from '../src/main/sse'
import { RetryPolicy } from '../src/main/retry'

/**
 * Üç katmanlı zaman aşımı — OpenCode `http.ts` parity.
 * Çalıştırma: node scripts/run-unit.cjs scripts/stream-idle-test.ts
 *
 *   headerTimeout : başlıklar gelene kadar
 *   chunkTimeout  : iki parça arası
 *   totalTimeout  : istek başından sonuna
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

type Mode = 'no-headers' | 'headers-then-silent' | 'slow-ok' | 'too-long-total'

function startServer(mode: Mode) {
  let requests = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      requests += 1
      if (mode === 'no-headers') {
        // Bağlantıyı kabul et, hiçbir şey yazma (başlık bile yok).
        return
      }
      if (mode === 'headers-then-silent') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.flushHeaders()
        return
      }
      if (mode === 'slow-ok') {
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
        }, 60)
        return
      }
      // too-long-total: sürekli yavaş parça, hiç bitmez
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const timer = setInterval(() => {
        response.write(sse({ choices: [{ delta: { content: 'x' } }] }))
      }, 80)
      response.on('close', () => clearInterval(timer))
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

const run = (port: number, timeouts: { headerMs?: number; chunkMs?: number; totalMs?: number } = {}) =>
  streamCompletion(
    `http://127.0.0.1:${port}`,
    'test',
    { model: 'x', messages: [{ role: 'user', content: 'x' }] },
    new AbortController().signal,
    () => undefined,
    {
      headerTimeoutMs: timeouts.headerMs ?? 400,
      chunkTimeoutMs: timeouts.chunkMs ?? 400,
      totalTimeoutMs: timeouts.totalMs ?? false,
      policy: new RetryPolicy({ maxRetries: 1, random: () => 0.5 })
    }
  )

void (async () => {
  // ===== 1) başlık gelmiyor → headerTimeout =====
  {
    const { server, port, count } = await startServer('no-headers')
    const started = Date.now()
    let tag = ''
    try {
      await run(port, { headerMs: 400 })
    } catch (error) {
      tag = (error as { reason?: { tag?: string } })?.reason?.tag ?? 'unknown'
    }
    const elapsed = Date.now() - started
    server.close()

    check('başlık zaman aşımı yakalandı', tag, 'Timeout')
    check('sonsuza kadar beklemedi', elapsed < 8_000, true)
    check('tek deneme (Timeout denenmez)', count(), 1)
  }

  // ===== 2) başlık var, gövde yok → chunkTimeout =====
  {
    const { server, port } = await startServer('headers-then-silent')
    const started = Date.now()
    let tag = ''
    try {
      await run(port, { chunkMs: 400 })
    } catch (error) {
      tag = (error as { reason?: { tag?: string } })?.reason?.tag ?? 'unknown'
    }
    const elapsed = Date.now() - started
    server.close()

    check('parça zaman aşımı yakalandı', tag, 'Transport')
    check('gövde sessizliği sınırlı sürede', elapsed < 8_000, true)
  }

  // ===== 3) yavaş ama düzenli akış etkilenmez =====
  {
    const { server, port } = await startServer('slow-ok')
    const started = Date.now()
    let content = ''
    let error = ''
    try {
      const result = await run(port, { chunkMs: 2_000, headerMs: 2_000 })
      content = result.content
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    const elapsed = Date.now() - started
    server.close()

    check('yavaş akış hata vermez', error, '')
    check('yavaş akış tamamlanır', content, 'p0 p1 p2 p3 ')
    check('parça süresi sayaç sıfırlar', elapsed >= 200, true)
  }

  // ===== 4) toplam süre aşılırsa kesilir =====
  {
    const { server, port } = await startServer('too-long-total')
    const started = Date.now()
    let tag = ''
    try {
      await run(port, { chunkMs: 5_000, headerMs: 5_000, totalMs: 500 })
    } catch (error) {
      tag = (error as { reason?: { tag?: string } })?.reason?.tag ?? 'unknown'
    }
    const elapsed = Date.now() - started
    server.close()
    server.closeAllConnections?.()

    check('toplam süre aşımı yakalandı', tag, 'Timeout')
    check('toplam süre sınırı uygulandı', elapsed < 6_000, true)
  }

  // ===== 5) kullanıcı iptali =====
  {
    const { server, port } = await startServer('headers-then-silent')
    const controller = new AbortController()
    const promise = streamCompletion(
      `http://127.0.0.1:${port}`,
      'test',
      { model: 'x', messages: [{ role: 'user', content: 'x' }] },
      controller.signal,
      () => undefined,
      { headerTimeoutMs: 30_000, chunkTimeoutMs: 30_000 }
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

  console.log(`TOTAL=11 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})()
