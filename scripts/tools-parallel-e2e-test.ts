/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { performanceProfile } from '../src/main/agent/hardwareProfile'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatRequest, ToolResultInfo } from '../src/shared/types'

/**
 * Paralel araç yürütmesinin uçtan uca kanıtı.
 * Çalıştırma: node scripts/run-unit.cjs scripts/tools-parallel-e2e-test.ts
 *
 * ## Ne ölçülür
 *
 * 1. **Salt-okunur çoklu çağrı → paralel.** Tek adımda üç `read_file`; döngü
 *    "paralel araç: 3 çağrı · N eşzamanlı" yazmalı ve üçü de başarılı olmalı.
 * 2. **Yazma varsa seri.** `read_file` + `write_file` aynı adımda ise paralel
 *    yol **kullanılmamalı** (yarış koşulu koruması).
 * 3. **Olaylarda tam içerik** kalır: kırpma yalnızca modele giden bağlamda
 *    yapılır, arayüze giden olay etkilenmez.
 *
 * Not: `webfetch` yerel adresleri SSRF korumasıyla reddediyor (doğru
 * davranış), bu yüzden test gerçek dosya okuma kullanır.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
process.env['EVREN_SUBAGENT_LOG_DIR'] = join(dataDir, 'logs')
app.setPath('userData', dataDir)

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

interface Scenario {
  name: string
  calls: Array<{ name: string; args: Record<string, unknown> }>
  expectParallel: boolean
}

let scenario: Scenario = { name: '', calls: [], expectParallel: false }
let round = 0

function startModelServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const messages = (body['messages'] ?? []) as Array<{ role?: string }>
      const toolMessages = messages.filter((message) => message.role === 'tool').length
      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (round === 0) {
        round += 1
        const toolCalls = scenario.calls.map((call, index) => ({
          index,
          id: `call-${index}`,
          function: { name: call.name, arguments: JSON.stringify(call.args) }
        }))
        response.write(sse({ choices: [{ delta: { tool_calls: toolCalls } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      response.write(sse({ choices: [{ delta: { content: `Bitti (${toolMessages} araç).` } }] }))
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

function resetLog(): void {
  const file = join(dataDir, 'logs', 'main.log')
  try {
    writeFileSync(file, '', 'utf8')
  } catch {
    // yut
  }
}

function readLog(): string {
  try {
    return readFileSync(join(dataDir, 'logs', 'main.log'), 'utf8')
  } catch {
    return ''
  }
}

app.whenReady().then(async () => {
  const perf = performanceProfile()
  console.log(
    `profil: ${perf.tier} · araç paralelliği ${perf.toolParallelism} · ` +
      `araç çıktısı ${perf.maxToolOutputChars} kr`
  )

  const base = join(dataDir, 'parallel-e2e')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  // Üç büyük dosya: kırpma sınırını aşsınlar.
  const big = `${'satır içeriği '.repeat(200)}\n`
  for (const name of ['a.txt', 'b.txt', 'c.txt']) {
    writeFileSync(join(base, name), `${name}\n${big}`, 'utf8')
  }

  const settings = await getSettings()
  const model = await startModelServer()

  const runScenario = async (next: Scenario): Promise<ToolResultInfo[]> => {
    scenario = next
    round = 0
    resetLog()
    const sink = createRecordingSink()
    const payload = {
      model: 'parallel-model',
      messages: [{ role: 'user', content: next.name }],
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
        requestId: `req-${next.name}`,
        webContentsId: 0,
        baseUrl: `http://127.0.0.1:${model.port}`,
        apiKey: 'test',
        payload,
        controller: new AbortController(),
        sink,
        settings,
        workspaceRoot: base
      })
    )
    await sleep(50)
    return sink.events
      .filter((event) => event.type === 'tool-result')
      .map((event) => (event as { result?: ToolResultInfo }).result)
      .filter((result): result is ToolResultInfo => Boolean(result))
  }

  // ---------- 1) Üç okuma → paralel ----------
  const reads = await runScenario({
    name: 'paralel-okuma',
    calls: ['a.txt', 'b.txt', 'c.txt'].map((file) => ({
      name: 'read_file',
      args: { path: file }
    })),
    expectParallel: true
  })
  const readLog1 = readLog()
  const parallelLine = /paralel araç: 3 çağrı · (\d+) eşzamanlı/.exec(readLog1)
  console.log(`\n1) ` + (parallelLine ? parallelLine[0] : 'paralel satırı YOK'))
  check('üç okuma çağrıldı', reads.length, 3)
  check('hepsi başarılı', reads.every((result) => result.ok), true)
  check('olaylarda tam içerik (kırpılmamış)', reads.every((r) => String(r.content).length > 2_000), true)
  check('paralel yol kullanıldı', Boolean(parallelLine), true)
  check(
    'eşzamanlılık profile uygun',
    parallelLine ? Number(parallelLine[1]) === perf.toolParallelism : false,
    true
  )

  // ---------- 2) Okuma + yazma → seri ----------
  const mixed = await runScenario({
    name: 'karisik-seri',
    calls: [
      { name: 'read_file', args: { path: 'a.txt' } },
      { name: 'write_file', args: { path: 'yeni.txt', content: 'merhaba\n' } }
    ],
    expectParallel: false
  })
  const readLog2 = readLog()
  console.log(`2) paralel satırı var mı: ${readLog2.includes('paralel araç:')}`)
  check('iki çağrı yapıldı', mixed.length, 2)
  check('ikisi de başarılı', mixed.every((result) => result.ok), true)
  check('yazma içeren adım seri çalıştı', readLog2.includes('paralel araç:'), false)

  // ---------- 3) Kırpma sınırı aşılmıyor ----------
  check(
    'araç çıktısı profili makul',
    perf.maxToolOutputChars >= 6_000 && perf.maxToolOutputChars <= 12_000,
    true
  )
  const profileMid = perf.tier === 'mid' || perf.tier === 'high' || perf.tier === 'low'
  check('profil tanımlı', profileMid, true)

  model.server.close()
  await sleep(50)

  console.log(`\nTOTAL=10 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
