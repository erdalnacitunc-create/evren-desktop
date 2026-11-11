/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import {
  MAX_SUBAGENTS_PER_REQUEST,
  MAX_CONCURRENT_SUBAGENTS
} from '../src/shared/agentTopology'
import type { ChatRequest } from '../src/shared/types'

/**
 * Alt ajan limitinin gerçek ajan döngüsünde çalıştığını doğrular.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-subagent-e2e-test.ts
 *
 * Sahte sağlayıcı:
 *  - ana ajanın ilk turunda 8 adet `spawn_agent` çağrısı döner (limit 6)
 *  - alt ajan turlarında kısa bir metin döner
 *
 * Beklenen: 8 çağrıdan yalnızca MAX_SUBAGENTS_PER_REQUEST kadarı başlar,
 * fazlası modele "bütçe doldu" mesajıyla reddedilir ve koşu tamamlanır.
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

const SPAWN_COUNT = 8
const spawnedModels: string[] = []
let mainTurns = 0

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
      const model = typeof body['model'] === 'string' ? body['model'] : ''
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const systemText =
        typeof messages[0]?.content === 'string' ? (messages[0].content as string) : ''
      // Alt ajan sistem istemini ayırt et: ana istemde de "ALT AJAN" geçiyor,
      // bu yüzden yalnızca alt ajana özgü cümleye bakılır.
      const isSubagent = /alt ajan[ıi]s[ıi]n/i.test(systemText)
      if (isSubagent) spawnedModels.push(model)

      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (isSubagent) {
        response.write(sse({ choices: [{ delta: { content: 'Alt ajan bulgusu: 3 dosya.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      mainTurns += 1
      if (mainTurns === 1) {
        // Görevler **bilinçli olarak farklı**: yinelenen-görev koruması
        // benzer metinleri reddediyor, bu test ise bütçeyi ölçüyor.
        const areas = [
          'kimlik doğrulama ve oturum yönetimi',
          'faturalama ve ödeme akışı',
          'arama indeksi ve sorgu katmanı',
          'dosya yükleme ve depolama',
          'bildirim ve e-posta kuyruğu',
          'raporlama ve dışa aktarma',
          'ayarlar ve tercih kalıcılığı',
          'eşitleme ve çakışma çözümü'
        ]
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: areas.map((area, index) => ({
                    index,
                    id: `spawn-${index}`,
                    function: {
                      name: 'spawn_agent',
                      arguments: JSON.stringify({
                        agent: 'explore',
                        prompt: `${area} ile ilgili tüm dosyaları bul, her birinde tanımlı dışa aktarılan fonksiyonları listele`,
                        background: false
                      })
                    }
                  }))
                }
              }
            ]
          })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
      } else {
        response.write(sse({ choices: [{ delta: { content: 'Rapor hazır.' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      }
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
  const base = join(process.env.EVREN_TEST_DATA as string, 'subagent-e2e')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'a.ts'), 'export const a = 1\n', 'utf8')

  const settings = await getSettings()
  const { server, port } = await startServer()
  const sink = createRecordingSink()

  const payload = {
    model: 'selected-model-x',
    messages: [{ role: 'user', content: 'tüm modülleri keşfet ve fonksiyonları listele' }],
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
      requestId: 'req-sub-e2e',
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

  // ===== 1) bütçe uygulandı =====
  check('8 istekten 6 alt ajan başladı', spawnedModels.length, MAX_SUBAGENTS_PER_REQUEST)
  check('sabit 6', MAX_SUBAGENTS_PER_REQUEST, 6)
  check('eşzamanlı sabit 6', MAX_CONCURRENT_SUBAGENTS, 6)

  // ===== 2) alt ajanlar seçili modeli kullandı =====
  check(
    'tüm alt ajanlar seçili modelde',
    spawnedModels.every((model) => model === 'selected-model-x'),
    true
  )

  // ===== 3) fazla istekler modele reddedildi =====
  const results = sink.events.filter((event) => event.type === 'tool-result') as Array<{
    result?: { ok?: boolean; content?: string; name?: string }
  }>
  const spawnResults = results.filter((event) => event.result?.name === 'spawn_agent')
  const rejected = spawnResults.filter((event) => event.result?.ok === false)
  check('8 spawn sonucu döndü', spawnResults.length, SPAWN_COUNT)
  check('2 istek reddedildi', rejected.length, SPAWN_COUNT - MAX_SUBAGENTS_PER_REQUEST)
  if (rejected.length > 0) {
    console.log('   red mesajı:', JSON.stringify(rejected[0]?.result?.content))
  }
  check(
    'red mesajı bütçeyi açıklıyor',
    rejected.every((event) => String(event.result?.content).includes('bütçesi doldu')),
    true
  )

  // ===== 4) koşu tamamlandı =====
  const done = sink.events.find((event) => event.type === 'done') as
    | { finishReason?: string }
    | undefined
  check('koşu tamamlandı', done?.finishReason, 'stop')
  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  check('nihai metin geldi', text.includes('Rapor hazır'), true)

  // ===== 5) sistem istemi devretme kuralını içeriyor =====
  check('ana ajan turu 2', mainTurns, 2)

  console.log(`TOTAL=11 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
