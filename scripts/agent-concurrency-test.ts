/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { pushSteering, clearAllSteering, countSteering } from '../src/main/agent/steering'
import { abortChat } from '../src/main/chat'

/**
 * Eşzamanlı ajan koşuları testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-concurrency-test.ts
 *
 * Süreç ayrımında bozulmaması gereken özellik: iki oturum aynı anda
 * çalışırken olaylar, steering ve çalışma alanları karışmamalı.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

/**
 * Her istek gövdesindeki oturum etiketine göre yanıt üretir.
 * Gecikme, iki koşunun gerçekten iç içe geçmesini sağlar.
 */
function makeServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const tag = /ETIKET:(\w+)/.exec(body)?.[1] ?? 'yok'
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const parts = ['a', 'b', 'c']
      let index = 0
      const timer = setInterval(() => {
        if (index >= parts.length) {
          response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
          response.write('data: [DONE]\n\n')
          response.end()
          clearInterval(timer)
          return
        }
        response.write(sse({ choices: [{ delta: { content: `${tag}${parts[index]}` } }] }))
        index += 1
      }, 20)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

function payload(tag: string) {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: `ETIKET:${tag}` }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: true
    }
  } as never
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'concurrency')
  const dirA = join(base, 'a')
  const dirB = join(base, 'b')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })

  const { server, port } = await makeServer()

  // ===== 1) iki koşu paralel, olaylar karışmıyor =====
  {
    const sinkA = createRecordingSink()
    const sinkB = createRecordingSink()
    clearAllSteering()
    pushSteering('req-A', 'A için ek talimat')
    pushSteering('req-B', 'B için ek talimat')

    await Promise.all([
      runWithWorkspace(dirA, () =>
        runAgent({
          requestId: 'req-A',
          webContentsId: 0,
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test',
          payload: payload('A'),
          controller: new AbortController(),
          sink: sinkA
        })
      ),
      runWithWorkspace(dirB, () =>
        runAgent({
          requestId: 'req-B',
          webContentsId: 0,
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test',
          payload: payload('B'),
          controller: new AbortController(),
          sink: sinkB
        })
      )
    ])

    const contentA = sinkA.events.filter((e) => e.type === 'content').map((e) => (e as { text: string }).text)
    const contentB = sinkB.events.filter((e) => e.type === 'content').map((e) => (e as { text: string }).text)

    check('A yalnızca kendi metnini aldı', contentA.every((text) => text.startsWith('A')), true)
    check('B yalnızca kendi metnini aldı', contentB.every((text) => text.startsWith('B')), true)
    // Steering ikinci bir tur başlatır: 3 parça + steering sonrası 3 parça.
    check('A parça sayısı (steering turu dahil)', contentA.length, 6)
    check('B parça sayısı (steering turu dahil)', contentB.length, 6)
    check('A steering olayı bir kez', sinkA.countOf('steering'), 1)
    check('B steering olayı bir kez', sinkB.countOf('steering'), 1)
    check(
      'A steering metni kendine ait',
      (sinkA.events.find((e) => e.type === 'steering') as { text: string }).text,
      'A için ek talimat'
    )
    check(
      'B steering metni kendine ait',
      (sinkB.events.find((e) => e.type === 'steering') as { text: string }).text,
      'B için ek talimat'
    )
    check('A tek done', sinkA.countOf('done'), 1)
    check('B tek done', sinkB.countOf('done'), 1)
    check(
      'olay kimlikleri doğru (A)',
      sinkA.events.every((event) => event.requestId === 'req-A'),
      true
    )
    check(
      'olay kimlikleri doğru (B)',
      sinkB.events.every((event) => event.requestId === 'req-B'),
      true
    )
  }

  // ===== 2) steering istek başına ayrı =====
  {
    clearAllSteering()
    pushSteering('req-A', 'sadece A')
    pushSteering('req-B', 'sadece B')
    check('A kuyruğu 1', countSteering('req-A'), 1)
    check('B kuyruğu 1', countSteering('req-B'), 1)
    pushSteering('req-C', 'C')
    check('C ayrı', countSteering('req-C'), 1)
    clearAllSteering()
    check('temizlendi', countSteering('req-A') + countSteering('req-B') + countSteering('req-C'), 0)
  }

  // ===== 3) uzun ve kısa koşu birlikte =====
  {
    const sinkLong = createRecordingSink()
    const sinkShort = createRecordingSink()

    await Promise.all([
      runWithWorkspace(dirA, () =>
        runAgent({
          requestId: 'long',
          webContentsId: 0,
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test',
          payload: payload('A'),
          controller: new AbortController(),
          sink: sinkLong
        })
      ),
      (async () => {
        await sleep(10)
        await runWithWorkspace(dirB, () =>
          runAgent({
            requestId: 'short',
            webContentsId: 0,
            baseUrl: `http://127.0.0.1:${port}`,
            apiKey: 'test',
            payload: payload('B'),
            controller: new AbortController(),
            sink: sinkShort
          })
        )
      })()
    ])

    check('uzun koşu tamamlandı', sinkLong.countOf('done'), 1)
    check('kısa koşu tamamlandı', sinkShort.countOf('done'), 1)
    check('uzun içerik A', (sinkLong.events.find((e) => e.type === 'content') as { text: string }).text.startsWith('A'), true)
    check('kısa içerik B', (sinkShort.events.find((e) => e.type === 'content') as { text: string }).text.startsWith('B'), true)
  }

  // ===== 4) bilinmeyen isteği iptal etmek hata vermez =====
  {
    check('bilinmeyen istek iptali false', abortChat('olmayan-istek'), false)
    check('boş istek iptali false', abortChat(''), false)
  }

  server.close()

  console.log(`TOTAL=23 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
