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
 * Alt ajan tetikleme sınaması (gerçekçi senaryo).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-spawn-trigger-test.ts
 *
 * ## Ne sınar
 *
 * Canlı koşuda alt ajan **hiç** tetiklenmiyordu. Bu test iki yolu ayrı ayrı
 * zorlar:
 *
 *  A) **Keşif ipucu yolu**: model 40+ dosyayı listeler, hiçbirini okumaz.
 *     Döngü keşif ipucunu göndermeli; model ipucundan sonra `spawn_agent`
 *     çağırmalı. Sonuçta alt ajan çalışmalı ve sonucu lidere dönmeli.
 *
 *  B) **Doğrudan devretme yolu**: model ilk turda kendisi `spawn_agent`
 *     çağırır (sistem istemindeki kurala uyar). Alt ajan gerçekten koşmalı,
 *     seçili modeli kullanmalı ve sonucu ana bağlama dönmeli.
 *
 * Sahte sağlayıcı modelin davranışını taklit eder; asıl doğrulanan şey
 * altyapının uçtan uca çalıştığıdır.
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

interface ServerControl {
  /** Ana ajanın her turunda ne yapacağı. */
  plan: (turn: number, sawHint: boolean) => 'list' | 'spawn' | 'text'
  subagentOutput: string
}

interface Captured {
  subagentCalls: number
  mainTurns: number
  hintSeen: boolean
  hintText: string
  subagentModels: string[]
  toolNames: string[]
}

function startServer(control: ServerControl) {
  const captured: Captured = {
    subagentCalls: 0,
    mainTurns: 0,
    hintSeen: false,
    hintText: '',
    subagentModels: [],
    toolNames: []
  }

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

      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const tools = (body['tools'] ?? []) as Array<{ function?: { name?: string } }>
      const systemText = messages
        .filter((message) => message.role === 'system')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n')
      const allText = messages
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n')

      const isSubagent = /alt ajan[ıi]s[ıi]n/i.test(systemText)
      const model = typeof body['model'] === 'string' ? body['model'] : ''

      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (isSubagent) {
        captured.subagentCalls += 1
        captured.subagentModels.push(model)
        response.write(sse({ choices: [{ delta: { content: control.subagentOutput } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      captured.mainTurns += 1
      captured.toolNames = tools.map((tool) => tool.function?.name ?? '?')

      // Keşif ipucu modele "user" mesajı olarak eklenir.
      if (/Birçok dosya listeledin/.test(allText)) {
        captured.hintSeen = true
        if (!captured.hintText) {
          const index = allText.indexOf('Birçok dosya listeledin')
          captured.hintText = allText.slice(Math.max(0, index - 60), index + 400)
        }
      }

      const action = control.plan(captured.mainTurns, captured.hintSeen)

      if (action === 'list') {
        // 30 dosya listele (içerik yok) — keşif ipucunu tetikler.
        const listing = Array.from(
          { length: 30 },
          (_, index) => `C:\\proje\\src\\modul${index}.cpp`
        ).join('\n')
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `list-${captured.mainTurns}`,
                      function: {
                        name: 'run_command',
                        arguments: JSON.stringify({
                          command: 'Get-ChildItem -Recurse -File | Select-Object FullName'
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
        // Listeleme sonucu araç çıktısından gelir; sahte araç yok, bu yüzden
        // gerçek dosyaları oluşturup gerçek komutu çalıştırıyoruz.
        response.end('data: [DONE]\n\n')
        return
      }

      if (action === 'spawn') {
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `spawn-${captured.mainTurns}`,
                      function: {
                        name: 'spawn_agent',
                        arguments: JSON.stringify({
                          agent: 'explore',
                          prompt:
                            'src/ altındaki tüm .cpp dosyalarını oku; gömülü sırları ve protokol sabitlerini dosya:satır ile listele',
                          background: false
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
        return
      }

      response.write(sse({ choices: [{ delta: { content: 'Keşif tamamlandı, rapor hazır.' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.end('data: [DONE]\n\n')
    })
  })

  return new Promise<{ server: ReturnType<typeof createServer>; port: number; captured: Captured }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve({
          server,
          port: typeof address === 'object' && address ? address.port : 0,
          captured
        })
      })
    }
  )
}

function makeWorkspace(base: string): void {
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src'), { recursive: true })
  for (let index = 0; index < 30; index += 1) {
    writeFileSync(
      join(base, 'src', `modul${index}.cpp`),
      `// modul ${index}\nconst char* WIFI_SSID = "ag-${index}";\nint sabit_${index} = ${index};\n`,
      'utf8'
    )
  }
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'spawn-trigger')
  makeWorkspace(base)
  const settings = await getSettings()

  // ============================================================
  // A) Keşif ipucu yolu: listele → ipucu → spawn → sentez
  // ============================================================
  {
    const control: ServerControl = {
      subagentOutput: 'Bulgu: src/modul0.cpp:2 içinde WIFI_SSID sabiti var.',
      plan: (turn, sawHint) => {
        if (turn === 1) return 'list'
        // İpucu geçmişte kalır; yalnızca ilk ipucu turunda spawn et.
        if (sawHint && turn === 2) return 'spawn'
        return 'text'
      }
    }
    const { server, port, captured } = await startServer(control)
    const sink = createRecordingSink()

    const payload = {
      model: 'trigger-model',
      messages: [
        {
          role: 'user',
          content: 'src klasöründeki tüm dosyaların içeriğini incele ve gömülü sırları bul'
        }
      ],
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
        requestId: 'req-spawn-a',
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

    const logs = sink.events
      .filter((event) => event.type === 'tool-result')
      .map((event) => String((event as { result?: { content?: string } }).result?.content ?? ''))

    check('A: listeleme yapıldı', logs.some((text) => text.includes('modul29.cpp')), true)
    check('A: keşif ipucu gönderildi', captured.hintSeen, true)
    check('A: ipucu spawn öneriyor', /spawn_agent/.test(captured.hintText), true)
    check('A: alt ajan tetiklendi', captured.subagentCalls, 1)
    check('A: alt ajan seçili modelde', captured.subagentModels[0], 'trigger-model')
    check(
      'A: alt ajan sonucu ana bağlama döndü',
      logs.some((text) => text.includes('WIFI_SSID sabiti')),
      true
    )
    const doneA = sink.events.find((event) => event.type === 'done') as
      | { finishReason?: string }
      | undefined
    check('A: koşu tamamlandı', doneA?.finishReason, 'stop')
  }

  // ============================================================
  // B) Doğrudan devretme: ilk turda spawn
  // ============================================================
  {
    const control: ServerControl = {
      subagentOutput: 'Bulgu: 3 dosyada protokol sabiti bulundu.',
      plan: (turn) => (turn === 1 ? 'spawn' : 'text')
    }
    const { server, port, captured } = await startServer(control)
    const sink = createRecordingSink()

    const payload = {
      model: 'direct-model',
      messages: [{ role: 'user', content: 'tüm .cpp dosyalarını oku ve sabitleri çıkar' }],
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
        requestId: 'req-spawn-b',
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

    check('B: ilk turda spawn çağrıldı', captured.subagentCalls, 1)
    check('B: seçili model kullanıldı', captured.subagentModels[0], 'direct-model')
    check(
      'B: spawn_agent araç listesinde',
      captured.toolNames.includes('spawn_agent'),
      true
    )
    const results = sink.events.filter((event) => event.type === 'tool-result') as Array<{
      result?: { name?: string; ok?: boolean; content?: string }
    }>
    const spawnResult = results.find((event) => event.result?.name === 'spawn_agent')
    check('B: spawn sonucu başarılı', spawnResult?.result?.ok, true)
    check(
      'B: sonuç metni lidere döndü',
      String(spawnResult?.result?.content ?? '').includes('protokol sabiti'),
      true
    )
    check('B: ana ajan 2 tur attı', captured.mainTurns, 2)
  }

  console.log(`TOTAL=13 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
