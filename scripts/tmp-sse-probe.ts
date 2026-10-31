/// <reference types="node" />
import { createServer } from 'http'
import { streamCompletion } from '../src/main/sse'

/** SSE ayrıştırıcısının yavaş/parçalı akışta tamamlandığını doğrular. */
const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

const server = createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const parts = ['BIR ', 'IKI ', 'UC ', 'DORT ', 'BES ', 'ALTI ', 'YEDI ', 'SEKIZ ']
    let index = 0
    const timer = setInterval(() => {
      if (index >= parts.length) {
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.write('data: [DONE]\n\n')
        response.end()
        clearInterval(timer)
        return
      }
      response.write(sse({ choices: [{ delta: { content: parts[index] } }] }))
      index += 1
    }, 500)
  })
})

server.listen(0, '127.0.0.1', async () => {
  const port = (server.address() as { port: number }).port
  const started = Date.now()
  const deltas: string[] = []
  try {
    const result = await streamCompletion(
      `http://127.0.0.1:${port}`,
      'test',
      { model: 'x', messages: [{ role: 'user', content: 'x' }] },
      new AbortController().signal,
      (delta) => deltas.push(delta.text)
    )
    console.log('TAMAMLANDI', Math.round((Date.now() - started) / 100) / 10 + 's')
    console.log('metin:', JSON.stringify(result.content))
    console.log('parça sayısı:', deltas.length)
    console.log('finishReason:', result.finishReason)
  } catch (error) {
    console.log('HATA:', error instanceof Error ? error.message : String(error))
  }
  server.close()
})
