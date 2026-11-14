/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { getSubagentTask } from '../src/main/agent/taskManager'
import { listSubagentTasks } from '../src/main/agent/taskManager'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatRequest, ToolResultInfo } from '../src/shared/types'

/**
 * `task_wait` semantiği ve `task_continue` testi (döngü düzeyi).
 * Çalıştırma: node scripts/run-unit.cjs scripts/subagent-wait-test.ts
 *
 * ## Neden
 *
 * 0.4.13 canlı koşusunda: explore ajanı 09:41:13'te başladı, `task_wait`
 * 120 sn'de `ok=false` döndü, ajan 09:44:19'da (186 sn) bitti ve 4820 kr
 * sonuç üretti — ana ajan sonucu hiç almadı, yanıtında "sonuç dönmedi" yazdı.
 * Zaman aşımı bir **hata değildir**; bu test bunu sabitler.
 *
 * Ayrıca Claude Code `resume` / opencode aynı `sessionID`'ye follow-up
 * davranışının karşılığı olan `task_continue` sınanır.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
process.env['EVREN_SUBAGENT_LOG_DIR'] = join(dataDir, 'subagent-logs')
mkdirSync(process.env['EVREN_SUBAGENT_LOG_DIR'] as string, { recursive: true })
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

const MAIN_ROUNDS: Array<{ name: string; args: Record<string, unknown> }> = [
  {
    name: 'spawn_agent',
    args: {
      agent: 'explore',
      prompt: 'Yavaş bir keşif görevi yap ve bulguları yaz.',
      background: true,
      description: 'yavaş keşif'
    }
  },
  { name: 'task_wait', args: { task_id: 'PLACEHOLDER', timeout_ms: 500 } },
  { name: 'task_wait', args: { task_id: 'PLACEHOLDER', timeout_ms: 20000 } },
  { name: 'task_status', args: { task_id: 'PLACEHOLDER' } },
  { name: 'task_continue', args: { task_id: 'PLACEHOLDER', prompt: 'Eksik kalan ikinci bölümü de yaz.' } },
  { name: 'task_wait', args: { task_id: 'PLACEHOLDER', timeout_ms: 20000 } },
  { name: 'task_logs', args: { task_id: 'PLACEHOLDER', limit: 50 } }
]

let mainRound = 0
let subagentRuns = 0
let taskId = ''
/** Ana ajana alt ajan bildirimi (system mesajı) ulaştı mı? */
let sawSubagentNotice = false

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
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

      if (
        messages.some((message) =>
          String(message.content ?? '').includes('ALT AJAN BİLDİRİMİ')
        )
      ) {
        sawSubagentNotice = true
      }

      if (isSubagent) {
        subagentRuns += 1
        const run = subagentRuns
        // Devam turu: önceki sonuç bağlamda mı?
        const context = messages.map((message) => String(message.content ?? '')).join('\n')
        const isContinuation = context.includes('birinci bolum tamam')

        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          // İlk koşu yavaş: task_wait 500 ms'de zaman aşımına uğramalı.
          const text = isContinuation
            ? 'ikinci bolum tamam'
            : 'birinci bolum tamam'
          response.write(sse({ choices: [{ delta: { content: text } }] }))
          response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
          response.end('data: [DONE]\n\n')
          void run
        }, isContinuation ? 150 : 2500)
        return
      }

      mainRound += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })

      // Sunucu, gerçek ajanda olduğu gibi görev kimliğini önceki araç
      // sonuçlarından öğrenir (spawn_agent yanıtı bağlamda durur).
      const toolText = messages
        .filter((message) => message.role === 'tool')
        .map((message) => String(message.content ?? ''))
        .join('\n')
      const knownTaskId = (toolText.match(/sub-[0-9a-f-]{36}/) ?? [])[0] ?? ''

      const scripted = MAIN_ROUNDS[mainRound - 1]
      if (scripted) {
        const args = { ...scripted.args }
        if (args['task_id'] === 'PLACEHOLDER') args['task_id'] = knownTaskId
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-${mainRound}`,
                      function: { name: scripted.name, arguments: JSON.stringify(args) }
                    }
                  ]
                }
              }
            ]
          })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      response.write(sse({ choices: [{ delta: { content: 'Bitti.' } }] }))
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
  const base = join(dataDir, 'wait-workspace')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })

  const settings = await getSettings()
  const { server, port } = await startServer()
  const sink = createRecordingSink()

  const payload = {
    model: 'wait-model',
    messages: [{ role: 'user', content: 'Alt ajanla yavaş bir keşif yap' }],
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
      requestId: 'req-wait',
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

  // Arka plandaki görev tamamen bitsin.
  for (let index = 0; index < 100; index += 1) {
    const task = taskId ? getSubagentTask(taskId) : null
    if (!task || task.status !== 'running') break
    await sleep(100)
  }
  await sleep(300)

  const results = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => Boolean(result))

  const byName = (name: string): ToolResultInfo[] => results.filter((result) => result.name === name)

  // spawn sonucundan görev kimliğini çıkar (sunucu sonraki turlarda kullanır)
  const spawnResult = byName('spawn_agent')[0]
  const spawnMatch = String(spawnResult?.content ?? '').match(/sub-[0-9a-f-]{36}/)
  taskId = spawnMatch ? spawnMatch[0] : ''
  check('spawn görev kimliği döndürdü', taskId.startsWith('sub-'), true)

  // NOT: Sunucu senaryosu task_id'yi ilk yanıttan önce bilmiyordu; bu yüzden
  // gerçek akışta ilk task_wait "Görev bulunamadı" dönebilir. Testin amacı
  // semantik olduğu için görev kimliğini doğrudan kayıttan doğruluyoruz.
  const tasks = listSubagentTasks()
  const task = tasks.find((item) => item.id === taskId)
  check('görev kaydı var', Boolean(task), true)
  check('etiket kaydedildi', task?.description, 'yavaş keşif')
  check('görev tamamlandı', task?.status, 'done')
  check('iki deneme (devam sayıldı)', task?.attempts, 2)

  const w1 = byName('task_wait')[0]
  const w2 = byName('task_wait')[1]
  const st = byName('task_status')[0]
  const cont = byName('task_continue')[0]
  const logs = byName('task_logs')[0]

  // ===== 1) zaman aşımı hata değildir =====
  check('ilk wait yapıldı', Boolean(w1), true)
  check('zaman aşımı ok=true', w1?.ok, true)
  check('zaman aşımı açıklaması', String(w1?.content ?? '').includes('hata değil'), true)
  check('zaman aşımı istem dökmez', String(w1?.content ?? '').includes('"prompt"'), false)

  // ===== 2) ikinci wait sonucu getirir =====
  check('ikinci wait başarılı', w2?.ok, true)
  check('ilk sonuç geldi', String(w2?.content ?? '').includes('birinci bolum tamam'), true)

  // ===== 3) task_status kompakt =====
  check('status kompakt', String(st?.content ?? '').length < 600, true)
  check('status istem dökmez', String(st?.content ?? '').includes('Yavaş bir keşif görevi'), false)
  check('status durumu gösterir', String(st?.content ?? '').includes('done'), true)

  // ===== 4) task_continue devam ettirir =====
  check('continue başarılı', cont?.ok, true)
  check('continue mesajı', String(cont?.content ?? '').includes('devam ettirildi'), true)

  // ===== 5) devam sonucu ayrı gelir =====
  const w3 = byName('task_wait')[2]
  check('devam sonucu', String(w3?.content ?? '').includes('ikinci bolum tamam'), true)

  // ===== 6) task_logs ayrıntı verir =====
  const logText = String(logs?.content ?? '')
  check('günlük ok=true', logs?.ok, true)
  check('günlük aşama içerir', /spawn|tool|state/.test(logText), true)
  check('günlük hata sayacı', logText.includes('hata'), true)

  // ===== 7) biten görev ana ajana bildirilir =====
  check('alt ajan bildirimi ana ajana ulaştı', sawSubagentNotice, true)

  console.log(`TOTAL=21 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
