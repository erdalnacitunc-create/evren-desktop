/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { modelGate } from '../src/main/agent/modelGate'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * TANI 2: stress S5 koşulunun birebir kopyası (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/gate-abort-diagnose2.ts
 *
 * ## Soru
 *
 * S5 üç koşunun ikisinde "eşzamanlılık 4, sınır 2" verdi. Ama daha yavaş
 * gecikmeyle yapılan ilk tanıda maxLive=2 çıktı. Fark: burada gecikme 120 ms
 * ve **uçuştaki 3 istek aynı anda** iptal ediliyor.
 *
 * ## İki hipotez
 *
 *  H1 (ölçüm): iptal edilen TCP bağlantıları birkaç ms "canlı" görünür;
 *     sunucu 2 eski + 2 yeni sayar. Kapı doğru.
 *  H2 (ürün): kapı, iptal edilen isteğin slotunu **erken** bırakır ve
 *     gerçekten sınırın üstünde istek açılır.
 *
 * ## Ayrım
 *
 * Her an için "canlı istekler" kümesini tutar ve **en yüksek eşzamanlılık
 * anında** bu kümenin kaçının iptal edilmiş olduğunu yazar. Ayrıca
 * tamamlanan (iptal edilmemiş) isteklerin en yüksek eşzamanlılığını ayrı
 * ölçer. H1 doğruysa: `maxCompleted ≤ N` ve aşım anındaki fazlalık
 * tamamen iptal edilmiş soketlerden oluşur.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface Rec {
  id: number
  tag: string
  start: number
  end?: number
  closed?: number
}

function startServer(delayMs: number) {
  const recs: Rec[] = []
  let seq = 0
  /** id → rec (canlı olanlar). */
  const live = new Map<number, Rec>()
  let maxLive = 0
  /** Aşım anındaki döküm. */
  let peakSnapshot: Array<{ tag: string; ageMs: number; closed: boolean }> = []
  let maxCompleted = 0
  const completedLive = new Set<number>()

  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const id = ++seq
      const tag = /TAG:([A-Za-z0-9_-]+)/.exec(raw)?.[1] ?? `anon${id}`
      const rec: Rec = { id, tag, start: Date.now() }
      recs.push(rec)
      live.set(id, rec)
      completedLive.add(id)
      maxCompleted = Math.max(maxCompleted, completedLive.size)

      if (live.size > maxLive) {
        maxLive = live.size
        const now = Date.now()
        peakSnapshot = [...live.values()].map((item) => ({
          tag: item.tag,
          ageMs: now - item.start,
          closed: item.closed !== undefined
        }))
      }

      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        live.delete(id)
        completedLive.delete(id)
      }

      response.on('close', () => {
        rec.closed = rec.closed ?? Date.now()
        // Yanıt bitmediyse istemci iptal etti: sağlayıcı bu isteği bırakır.
        if (!response.writableEnded) settle()
      })

      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(sse({ choices: [{ delta: { content: 'tamam' } }] }))
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        response.end('data: [DONE]\n\n')
        rec.end = Date.now()
        settle()
      }, delayMs)
    })
  })

  return new Promise<{
    server: ReturnType<typeof createServer>
    port: number
    report: () => {
      maxLive: number
      maxCompleted: number
      peakSnapshot: typeof peakSnapshot
      recs: Rec[]
    }
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        report: () => ({ maxLive, maxCompleted, peakSnapshot, recs })
      })
    })
  })
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'abort-diag2')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src'), { recursive: true })
  writeFileSync(join(base, 'src', 'a.ts'), 'const a = 1\n', 'utf8')

  // S5 ile birebir: 120 ms gecikme.
  const { server, port, report } = await startServer(120)

  const run = (tag: string, controller: AbortController) =>
    runWithWorkspace(base, () =>
      runSubagent({
        parentRequestId: `req-${tag}`,
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'diag',
        agentType: 'explore',
        prompt: `TAG:${tag} — src/a.ts oku.`,
        workspaceRoot: base,
        mode: 'auto',
        profile: 'build',
        controller,
        send: () => undefined
      })
    ).catch(() => null)

  const controllers = Array.from({ length: 6 }, () => new AbortController())
  const runs = controllers.map((controller, index) => run(`r${index}`, controller))

  // S5 ile aynı: 80 ms sonra ilk 3'ü iptal et.
  await sleep(80)
  for (const controller of controllers.slice(0, 3)) controller.abort()

  await Promise.all(runs)
  await sleep(1200)

  const result = report()
  server.closeAllConnections?.()
  server.close()

  const limit = modelGate.maxConcurrent
  console.log(`\n=== tanı 2: S5 koşulu birebir (gecikme 120 ms, uçuşta 3 iptal) ===`)
  console.log(`istek=${result.recs.length} · kapı sınırı=${limit}`)
  console.log(`TCP düzeyi en fazla canlı      (maxLive)      = ${result.maxLive}`)
  console.log(`Tamamlanan istekler en fazla   (maxCompleted) = ${result.maxCompleted}`)

  if (result.maxLive > limit) {
    console.log(`\nAŞIM ANINDAKİ CANLI İSTEKLER (${result.peakSnapshot.length}):`)
    for (const item of result.peakSnapshot) {
      console.log(
        `  ${item.tag.padEnd(5)} yaş=${String(item.ageMs).padStart(4)}ms ` +
          `${item.closed ? 'SOKET KAPANDI (iptal)' : 'hâlâ açık'}`
      )
    }
    const closedCount = result.peakSnapshot.filter((item) => item.closed).length
    console.log(
      `\n  kapanmış soket=${closedCount} / açık=${result.peakSnapshot.length - closedCount}`
    )
  }

  console.log('\nzaman çizelgesi (göreli ms):')
  const t0 = Math.min(...result.recs.map((rec) => rec.start))
  for (const rec of result.recs) {
    const start = String(rec.start - t0).padStart(5)
    const end = rec.end !== undefined ? String(rec.end - t0).padStart(5) : '    -'
    const closed = rec.closed !== undefined ? String(rec.closed - t0).padStart(5) : '    -'
    console.log(
      `  #${String(rec.id).padStart(2)} ${rec.tag.padEnd(5)} start=${start} end=${end} close=${closed}`
    )
  }

  const completedOk = result.maxCompleted <= limit
  console.log(
    `\nKARAR: ${completedOk ? 'H1 — tamamlanan istekler sınırı aşmadı; aşım iptal edilen soketlerden' : 'H2 — GERÇEK KAPI HATASI: tamamlanan istekler de sınırı aştı'}`
  )
  app.exit(completedOk ? 0 : 1)
})
