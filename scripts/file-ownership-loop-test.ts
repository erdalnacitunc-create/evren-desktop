/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import type { ChatRequest } from '../src/shared/types'

/**
 * Döngü düzeyinde dosya sahipliği testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/file-ownership-loop-test.ts
 *
 * ## Ne ölçülür
 *
 * 1. `general` ajan `files` vermeden başlatılamaz.
 * 2. Eşzamanlı iki `general` ajan aynı dosyayı alamaz.
 * 3. Ayrık dosya kümeleri alabilir.
 * 4. Ajanın yazması gerçekten o dosyalarla sınırlı (araç düzeyi).
 *
 * NOT: sahiplik **eşzamanlı** ajanlar arasında anlamlıdır; bu yüzden ajanlar
 * arka planda (background) başlatılır. Ön planda ajanlar sırayla koşar,
 * sahipliği bırakır ve çakışma hiç oluşmaz — bu da doğru davranış.
 *
 * Bu test aynı zamanda bir **kapı sızıntısını** yakalar: reddedilen spawn
 * eşzamanlılık slotunu geri vermezse meşru spawn'lar kuyruğa girer ve
 * sahiplikler sırayla alınır (0.4.13'te yaşandı).
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

const spawnCalls = [
  // 1. general, files YOK → reddedilmeli
  { agent: 'general', prompt: 'auth modülünü düzenle', background: true },
  // 2. general, files var → kabul
  {
    agent: 'general',
    prompt: 'src/auth altındaki dosyaları düzenle',
    background: true,
    files: ['src/auth/']
  },
  // 3. general, aynı dosya → çakışma
  {
    agent: 'general',
    prompt: 'src/auth/login.ts dosyasını düzelt',
    background: true,
    files: ['src/auth/login.ts']
  },
  // 4. general, ayrık → kabul
  {
    agent: 'general',
    prompt: 'src/billing altındaki dosyaları düzenle',
    background: true,
    files: ['src/billing/']
  },
  // 5. explore, files yok → kabul (salt-okunur)
  { agent: 'explore', prompt: 'tüm modülleri listele', background: true }
]

let mainRound = 0

interface WireMessage {
  role?: string
  content?: unknown
}

function subagentTurn(
  response: import('http').ServerResponse,
  systemText: string,
  toolTurns: number
): void {
  const isAuthAgent = systemText.includes('src/auth/')
  const allowedPath = isAuthAgent ? 'src/auth/generated.ts' : 'src/billing/generated.ts'
  const forbiddenPath = isAuthAgent ? 'src/billing/pay.ts' : 'src/auth/login.ts'

  response.writeHead(200, { 'content-type': 'text/event-stream' })

  // 0. tur: yasak yolu dene (araç reddetmeli)
  // 1. tur: izinli yolu yaz
  // 2. tur: bitir — aksi hâlde alt ajan adım limitine kadar döner.
  if (toolTurns >= 2) {
    response.write(sse({ choices: [{ delta: { content: 'Tamam.' } }] }))
    response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
    response.end('data: [DONE]\n\n')
    return
  }

  const target = toolTurns === 0 ? forbiddenPath : allowedPath
  response.write(
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call-${toolTurns}`,
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: target,
                    content: toolTurns === 0 ? 'HACKED\n' : 'OK\n'
                  })
                }
              }
            ]
          }
        }
      ]
    })
  )
  response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
  response.end('data: [DONE]\n\n')
}

function startServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const messages = (body['messages'] ?? []) as WireMessage[]
      const systemText = messages
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n')
      const isSubagent = /alt ajan[ıi]s[ıi]n/i.test(systemText)

      if (isSubagent) {
        const toolTurns = messages.filter((m) => m.role === 'tool').length
        subagentTurn(response, systemText, toolTurns)
        return
      }

      mainRound += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (mainRound === 1) {
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: spawnCalls.map((call, index) => ({
                    index,
                    id: `spawn-${index}`,
                    function: { name: 'spawn_agent', arguments: JSON.stringify(call) }
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'ownership-loop')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src', 'auth'), { recursive: true })
  mkdirSync(join(base, 'src', 'billing'), { recursive: true })
  writeFileSync(join(base, 'src', 'auth', 'login.ts'), 'export const a = 1\n', 'utf8')
  writeFileSync(join(base, 'src', 'billing', 'pay.ts'), 'export const b = 1\n', 'utf8')

  const settings = await getSettings()
  const { server, port } = await startServer()
  const sink = createRecordingSink()

  const payload = {
    model: 'ownership-model',
    messages: [{ role: 'user', content: 'auth ve billing modüllerini paralel düzenle' }],
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
      requestId: 'req-ownership',
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

  // Arka plan ajanları bitene kadar bekle.
  for (let index = 0; index < 150; index += 1) {
    const running = sink.events.filter(
      (event) =>
        event.type === 'subagent-task' &&
        (event as { task?: { status?: string } }).task?.status === 'running'
    ).length
    if (running === 0) break
    await sleep(100)
  }
  await sleep(400)
  server.close()

  const results = sink.events.filter((event) => event.type === 'tool-result') as Array<{
    result?: { name?: string; ok?: boolean; content?: string }
  }>
  const spawnResults = results.filter((event) => event.result?.name === 'spawn_agent')
  const rejected = spawnResults.filter((event) => event.result?.ok === false)
  const texts = spawnResults.map((r) => String(r.result?.content ?? ''))

  console.log(
    `\nspawn: ${spawnResults.length} | kabul: ${spawnResults.length - rejected.length} | ret: ${rejected.length}`
  )

  // ===== 1) sayılar =====
  check('5 spawn sonucu', spawnResults.length, 5)
  check('2 reddedildi (files yok + çakışma)', rejected.length, 2)
  check('3 kabul edildi', spawnResults.length - rejected.length, 3)

  // ===== 2) mesajlar =====
  check(
    'files zorunlu mesajı',
    texts.some((t) => t.includes('files') && t.includes('gerekli')),
    true
  )
  check(
    'çakışma mesajı',
    texts.some((t) => t.includes('Dosya sahipliği çakışması')),
    true
  )
  check(
    'sahiplik listesi mesajda',
    texts.some((t) => t.includes('src/auth/')),
    true
  )

  // ===== 3) yasak yazma engellendi =====
  check(
    'auth dosyası değişmedi',
    readFileSync(join(base, 'src', 'auth', 'login.ts'), 'utf8').includes('HACKED'),
    false
  )
  check(
    'billing dosyası değişmedi',
    readFileSync(join(base, 'src', 'billing', 'pay.ts'), 'utf8').includes('HACKED'),
    false
  )

  const writes = results.filter((r) => r.result?.name === 'write_file')
  const blockedWrites = writes.filter((r) => r.result?.ok === false)
  check('yazma denemesi yapıldı', writes.length > 0, true)
  check('en az bir yazma reddedildi', blockedWrites.length > 0, true)
  check(
    'ret mesajı sahiplik kuralını açıklıyor',
    blockedWrites.some((r) => /atanmadı|iznin/.test(String(r.result?.content ?? ''))),
    true
  )

  // ===== 4) izinli yazma geçti =====
  const created = [
    join(base, 'src', 'auth', 'generated.ts'),
    join(base, 'src', 'billing', 'generated.ts')
  ].filter((file) => {
    try {
      return readFileSync(file, 'utf8').includes('OK')
    } catch {
      return false
    }
  })
  check('izinli dosya oluştu', created.length >= 1, true)

  console.log(`TOTAL=12 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
