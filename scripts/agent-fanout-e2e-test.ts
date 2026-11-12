/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { MAX_FANOUT_CONCURRENCY } from '../src/shared/agentFanout'
import type { ChatRequest } from '../src/shared/types'

/**
 * Kademeli fan-out testi (uçtan uca).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-fanout-e2e-test.ts
 *
 * ## Ne ölçülür
 *
 * Canlı kusur: model tek seferde 4 `spawn_agent` çağırıyordu. Ana ajan 4 ajan
 * başlatınca sağlayıcıya **5× ani istek** gidiyor, "slow_down" (ramp-rate)
 * tetikleniyor ve 11 retry oluşuyordu.
 *
 * Bu test alt ajan kapısının varsayılan eşzamanlılığının 2 olduğunu ve
 * 4 isteğin 2+2 dalga hâlinde çalıştığını doğrular.
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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface Observed {
  /** Aynı anda kaç alt ajan koşuyor. */
  active: number
  /** Zaman içinde gözlenen en yüksek eşzamanlı alt ajan sayısı. */
  peak: number
  subagentStarts: number[]
  toolRounds: number
}

function startServer(control: { spawnCount: number; subagentDelayMs: number }) {
  const observed: Observed = { active: 0, peak: 0, subagentStarts: [], toolRounds: 0 }
  const startedAt = Date.now()

  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const systemText = messages
        .filter((message) => message.role === 'system')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n')
      const isSubagent = /alt ajan[ıi]s[ıi]n/i.test(systemText)

      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (isSubagent) {
        observed.active += 1
        observed.peak = Math.max(observed.peak, observed.active)
        observed.subagentStarts.push(Date.now() - startedAt)
        // Alt ajan işini geciktir: eşzamanlılık penceresi görünür olsun.
        setTimeout(() => {
          observed.active -= 1
          response.write(sse({ choices: [{ delta: { content: 'Alt ajan bulgusu.' } }] }))
          response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
          response.end('data: [DONE]\n\n')
        }, control.subagentDelayMs)
        return
      }

      observed.toolRounds += 1
      if (observed.toolRounds === 1) {
        const areas = [
          'kimlik doğrulama katmanı',
          'faturalama akışı',
          'arama indeksi',
          'dosya depolama katmanı'
        ]
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: areas.slice(0, control.spawnCount).map((area, index) => ({
                    index,
                    id: `spawn-${index}`,
                    function: {
                      name: 'spawn_agent',
                      arguments: JSON.stringify({
                        agent: 'explore',
                        prompt: `${area} ile ilgili tüm dosyaları oku ve mimariyi çıkar`,
                        background: true
                      })
                    }
                  }))
                }
              }
            ]
          })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      response.write(sse({ choices: [{ delta: { content: 'Rapor hazır.' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.end('data: [DONE]\n\n')
    })
  })

  return new Promise<{ server: ReturnType<typeof createServer>; port: number; observed: Observed }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve({
          server,
          port: typeof address === 'object' && address ? address.port : 0,
          observed
        })
      })
    }
  )
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'fanout-e2e')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'a.ts'), 'export const a = 1\n', 'utf8')

  const settings = await getSettings()
  const { server, port, observed } = await startServer({
    spawnCount: 4,
    subagentDelayMs: 120
  })
  const sink = createRecordingSink()

  const payload = {
    model: 'fanout-model',
    messages: [{ role: 'user', content: 'tüm katmanları incele ve mimariyi çıkar' }],
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
      requestId: 'req-fanout-e2e',
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

  // Alt ajanlar bitene kadar bekle (task_wait yoksa bile arka planda sürer).
  for (let index = 0; index < 100 && observed.active > 0; index += 1) await sleep(50)
  await sleep(200)
  server.close()

  // ===== 1) dört ajan da başladı =====
  check('4 alt ajan başladı', observed.subagentStarts.length, 4)

  // ===== 2) eşzamanlılık 2'yi aşmadı =====
  check('tepe eşzamanlılık 2', observed.peak, MAX_FANOUT_CONCURRENCY)
  check('tepe 4 değil (önceki kusur)', observed.peak < 4, true)

  // ===== 3) kademeli başlatma: ikinci dalga gecikmeli =====
  const first = observed.subagentStarts[0] ?? 0
  const second = observed.subagentStarts[1] ?? first
  const third = observed.subagentStarts[2] ?? second
  // İlk `concurrency` (2) ajan birlikte gider — bu tasarım gereği.
  check('ilk iki ajan birlikte başladı', Math.abs(second - first) < 60, true)
  check('üçüncü ajan ikinci dalgada', third - second > 80, true)
  check('dördüncü ajan üçüncüyle birlikte', Math.abs((observed.subagentStarts[3] ?? 0) - third) < 80, true)

  // ===== 4) koşu tamamlandı =====
  const done = sink.events.find((event) => event.type === 'done') as
    | { finishReason?: string }
    | undefined
  check('koşu tamamlandı', done?.finishReason !== undefined, true)

  console.log(
    `\nzaman çizelgesi: ${observed.subagentStarts.map((t) => t + 'ms').join(', ')} · tepe: ${observed.peak}`
  )
  console.log(`TOTAL=6 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
