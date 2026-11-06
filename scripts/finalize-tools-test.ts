/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatRequest } from '../src/shared/types'

/**
 * Adım sınırı turunda `tools` gövdesi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/finalize-tools-test.ts
 *
 * ## Neden
 *
 * 1 Kasım günlüğünde şu hata vardı:
 *
 *   Nihai yanıt isteği başarısız (max-steps): Error: `tools` must not be an
 *   empty array. Either provide at least one tool or omit the field entirely.
 *
 * `finalizeRun` araçsız tur için `tools: []` gönderiyordu. Sağlayıcı bunu
 * reddedince modelin kendi nihai yanıtı kayboluyor, yerine yedek özet
 * yazılıyordu. Adım sınırı varsayılan olarak kapalı olduğu için hata uzun
 * süre görünmedi — `agent.steps` ayarlanınca geri gelirdi.
 *
 * Bu test sahte sağlayıcıyla o yolu zorlar: boş `tools` dizisi gelirse
 * gerçekçi bir 400 döner.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface Observed {
  hasTools: boolean
  toolCount: number
  toolChoice?: string
}

const observed: Observed[] = []
let finalizeAnswered = false

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(raw || '{}') as Record<string, unknown>
      } catch {
        body = {}
      }

      const tools = body['tools']
      const hasTools = tools !== undefined
      const toolCount = Array.isArray(tools) ? tools.length : 0
      observed.push({
        hasTools,
        toolCount,
        toolChoice: typeof body['tool_choice'] === 'string' ? body['tool_choice'] : undefined
      })

      // Gerçek sağlayıcı davranışı: boş dizi → 400.
      if (hasTools && Array.isArray(tools) && tools.length === 0) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            error: {
              message:
                '`tools` must not be an empty array. Either provide at least one tool or omit the field entirely.',
              type: 'invalid_request_error',
              param: 'tools'
            }
          })
        )
        return
      }

      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (body['tool_choice'] === 'none') {
        // Nihai yanıt turu: model metin yazar.
        finalizeAnswered = true
        response.write(sse({ choices: [{ delta: { content: 'Nihai özet: iki seri port var.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      // Normal turlar: her seferinde bir araç çağır (sınıra doğru).
      response.write(
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${observed.length}`,
                    function: { name: 'list_files', arguments: '{}' }
                  }
                ]
              }
            }
          ]
        })
      )
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
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
  const base = join(process.env.EVREN_TEST_DATA as string, 'finalize-tools')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const settings = await getSettings()

  const { server, port } = await startServer()
  const sink = createRecordingSink()

  const payload = {
    model: 'test-model',
    messages: [{ role: 'user', content: 'dosyaları listele' }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true,
      // Adım sınırı 2: 3. turda finalizeRun(max-steps) devreye girer.
      steps: 2
    }
  } as ChatRequest

  await runWithWorkspace(base, () =>
    runAgent({
      requestId: 'req-finalize',
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

  // ===== 1) hiçbir istekte boş tools dizisi gönderilmedi =====
  const emptyTools = observed.filter((item) => item.hasTools && item.toolCount === 0)
  check('boş tools dizisi gönderilmedi', emptyTools.length, 0)

  // ===== 2) nihai tur gerçekten çalıştı =====
  check('nihai yanıt turu tetiklendi', finalizeAnswered, true)

  const finalCall = observed.find((item) => item.toolChoice === 'none')
  check('nihai turda tool_choice none', finalCall?.toolChoice, 'none')
  check('nihai turda araç tanımları dolu', (finalCall?.toolCount ?? 0) > 0, true)

  // ===== 3) metin modelden geldi, yedek özet değil =====
  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  check('modelin nihai metni geldi', text.includes('Nihai özet'), true)
  check('yedek özete düşülmedi', /Adım sınırına ulaştım|Araç çağrısı sınırına/.test(text), false)

  // ===== 4) bitiş nedeni doğru =====
  const done = sink.events.find((event) => event.type === 'done') as
    | { finishReason?: string }
    | undefined
  check('bitiş nedeni max-steps', done?.finishReason, 'max-steps')

  // ===== 5) ilk turda da araçlar dolu gitti =====
  check('ilk istekte araçlar dolu', (observed[0]?.toolCount ?? 0) > 0, true)
  check('ilk istekte tool_choice auto', observed[0]?.toolChoice, 'auto')

  console.log(`TOTAL=9 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
