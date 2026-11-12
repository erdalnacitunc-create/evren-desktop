/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { runWithWorkspace } from '../src/main/workspace'
import type { ChatEvent } from '../src/shared/types'

/**
 * Alt ajan adım limiti testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-subagent-limit-result-test.ts
 *
 * ## Canlı kusur
 *
 * plc_proje koşusunda 4 paralel explore ajanının **dördü de** adım limitine
 * takıldı ve boş sonuç döndürdü:
 *
 *   "Alt ajan adım limitine ulaştı.\n\n"   ← sonrası boş
 *
 * Ana ajan dört boş sonuç aldı; alt ajanlar tamamen boşa gitti.
 *
 * ## Beklenen davranış
 *
 * Limit dolunca alt ajan **metin zorunlu** bir sentez turu atar
 * (`tool_choice: none`, araç tanımları dolu) ve elindeki bulguları yazar.
 * Bu test o yolu zorlar: model 25 adım boyunca araç çağırır, metin yazmaz.
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

interface Capture {
  toolRounds: number
  finalRounds: number
  finalHadFullTools: boolean
  finalToolChoice: string | null
  sawNudge: boolean
}

function startServer() {
  const capture: Capture = {
    toolRounds: 0,
    finalRounds: 0,
    finalHadFullTools: false,
    finalToolChoice: null,
    sawNudge: false
  }

  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const tools = (body['tools'] ?? []) as Array<unknown>
      const toolChoice = typeof body['tool_choice'] === 'string' ? body['tool_choice'] : null
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const allText = messages
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n')

      if (/DURUM:|Adım sınırına ulaştın/.test(allText)) capture.sawNudge = true

      response.writeHead(200, { 'content-type': 'text/event-stream' })

      // Sentez turu: araçlar dolu + tool_choice none
      if (toolChoice === 'none') {
        capture.finalRounds += 1
        capture.finalHadFullTools = tools.length > 0
        capture.finalToolChoice = toolChoice
        response.write(
          sse({ choices: [{ delta: { content: 'RAPOR: firmware 16 başlık dosyası içeriyor; sırlar ayarlar.h:2-6.' } }] })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      // Normal tur: hep araç çağır, hiç metin yazma.
      capture.toolRounds += 1
      response.write(
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${capture.toolRounds}`,
                    function: { name: 'list_files', arguments: '{"path":"."}' }
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

  return new Promise<{ server: ReturnType<typeof createServer>; port: number; capture: Capture }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve({
          server,
          port: typeof address === 'object' && address ? address.port : 0,
          capture
        })
      })
    }
  )
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'limit-result')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'a.h'), 'int x = 1;\n', 'utf8')

  const { server, port, capture } = await startServer()
  const events: ChatEvent[] = []

  const result = await runWithWorkspace(base, () =>
    runSubagent({
      parentRequestId: 'req-limit',
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test',
      model: 'limit-model',
      agentType: 'explore',
      prompt: 'firmware/ altındaki tüm .h dosyalarını oku ve mimariyi çıkar',
      workspaceRoot: base,
      mode: 'auto',
      profile: 'build',
      controller: new AbortController(),
      send: (event) => events.push(event)
    })
  )
  server.close()

  // ===== 1) sonuç boş değil =====
  check('alt ajan sonucu boş değil', result.content.trim().length > 20, true)
  check('sonuç rapormuş gibi', /RAPOR|firmware/i.test(result.content), true)
  check('sonuç ok=true', result.ok, true)

  // ===== 2) sentez turu atıldı =====
  check('sentez turu yapıldı', capture.finalRounds >= 1, true)
  check('sentezde araç tanımları dolu', capture.finalHadFullTools, true)
  check('sentezde tool_choice none', capture.finalToolChoice, 'none')

  // ===== 3) adım limiti aşılmadı =====
  check('araç turu 20 ile sınırlı', capture.toolRounds <= 20, true)

  // ===== 4) ilerleme yönlendirmesi devreye girdi =====
  check('ilerleme yönlendirmesi gönderildi', capture.sawNudge, true)

  // ===== 5) eski hatalı metin yok =====
  check(
    'eski "adım limitine ulaştı" metni yok',
    /adım limitine ulaştı/i.test(result.content),
    false
  )

  console.log(`TOTAL=9 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
