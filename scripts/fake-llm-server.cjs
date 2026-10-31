/**
 * Sahte LLM sunucusu (ayrı süreç).
 * Başladığında stdout'a "PORT=<n>" yazar.
 *
 * /v1/models  → tek model
 * /v1/quota   → sabit kota
 * /v1/chat/completions → yavaş SSE akışı (kademeli parçalar)
 */
const http = require('http')

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`

const MODELS = {
  data: [
    {
      id: 'test-model',
      object: 'model',
      task: 'chat',
      context_length: 100000,
      default_max_output_tokens: 4096,
      capabilities: { vision: false, tools: true }
    }
  ]
}

const server = http.createServer((request, response) => {
  const url = request.url || ''
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    if (url.startsWith('/v1/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(MODELS))
      return
    }
    if (url.startsWith('/v1/quota')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ credits: 0, limit: 1, remaining: 1, window: 'test' }))
      return
    }
    if (url.startsWith('/v1/chat/completions')) {
      // Ajan adımı mı, düz sohbet mi? Gövdedeki "tools" alanına bak.
      const isAgentStep = body.includes('"tools"')
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const parts = ['BIR ', 'IKI ', 'UC ', 'DORT ', 'BES ', 'ALTI ', 'YEDI ', 'SEKIZ ']
      let index = 0
      const timer = setInterval(() => {
        if (index >= parts.length || response.writableEnded) {
          if (!response.writableEnded) {
            response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
            response.write('data: [DONE]\n\n')
            response.end()
          }
          clearInterval(timer)
          return
        }
        response.write(sse({ choices: [{ delta: { content: parts[index] } }] }))
        process.stdout.write(`CHUNK ${index} agent=${isAgentStep}\n`)
        index += 1
      }, 500)
      response.on('close', () => {
        clearInterval(timer)
        process.stdout.write(`CLOSE index=${index}\n`)
      })
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{}')
  })
})

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT=${server.address().port}\n`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
