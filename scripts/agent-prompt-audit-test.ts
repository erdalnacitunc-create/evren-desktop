/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatRequest } from '../src/shared/types'

/**
 * Teşhis: ajan isteğinde hangi araçlar var ve sistem istemi ne içeriyor?
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-prompt-audit-test.ts
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

let captured: { tools: string[]; system: string; toolChoice?: string } | null = null

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const tools = (body['tools'] ?? []) as Array<{ function?: { name?: string } }>
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const system = messages
        .filter((message) => message.role === 'system')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n')

      if (!captured) {
        captured = {
          tools: tools.map((tool) => tool.function?.name ?? '?'),
          system,
          toolChoice: typeof body['tool_choice'] === 'string' ? body['tool_choice'] : undefined
        }
      }

      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(sse({ choices: [{ delta: { content: 'bitti' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'prompt-audit')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'x.ts'), 'export const x = 1\n', 'utf8')

  const settings = await getSettings()
  const { server, port } = await startServer()
  const sink = createRecordingSink()

  const payload = {
    model: 'audit-model',
    messages: [{ role: 'user', content: 'projede tüm modülleri keşfet ve incele' }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as ChatRequest

  await runWithWorkspace(base, () =>
    runAgent({
      requestId: 'req-audit',
      webContentsId: 0,
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test',
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: base
    })
  )
  server.close()

  if (!captured) {
    console.log('HATA: istek yakalanmadı')
    app.exit(1)
    return
  }

  console.log(`\naraç sayısı: ${captured.tools.length}`)
  console.log(`spawn_agent var mı: ${captured.tools.includes('spawn_agent')}`)
  console.log(`task_wait var mı: ${captured.tools.includes('task_wait')}`)
  console.log(`skill var mı: ${captured.tools.includes('skill')}`)
  console.log(`tool_choice: ${captured.toolChoice ?? '-'}`)
  console.log(`sistem istemi uzunluğu: ${captured.system.length}`)
  console.log(`delegation bölümü var mı: ${captured.system.includes('ALT AJAN KULLANIMI')}`)
  console.log(`alt ajan sınırı yazıyor mu: ${/en fazla 6/.test(captured.system)}`)
  console.log(`skill kataloğu var mı: ${captured.system.includes('Kullanılabilir beceriler')}`)
  console.log('\n--- araç listesi ---')
  console.log(captured.tools.join(', '))

  app.exit(0)
})
