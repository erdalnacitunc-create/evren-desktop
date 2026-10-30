/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { runLighthouseAudit } from '../src/main/lighthouse'

/**
 * Gerçek Lighthouse denetimi (Chrome/Edge gerektirir).
 * Çalıştırma: node scripts/run-unit.cjs scripts/lighthouse-live-test.ts
 *
 * Ağ gerekmesin diye yerel bir HTTP sunucusu üzerinden basit bir sayfa denetlenir.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, ok: boolean, detail?: string): void {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const PAGE = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>EVREN Lighthouse testi</title>
<meta name="description" content="Yerel denetim sayfası">
</head><body><h1>Merhaba</h1><p>Basit bir sayfa.</p></body></html>`

app.whenReady().then(async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(PAGE)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const dir = join(process.cwd(), 'node_modules', '.cache', `lh-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const started = Date.now()
  const result = await runLighthouseAudit({
    url: `http://127.0.0.1:${port}/`,
    categories: ['accessibility', 'best-practices', 'seo'],
    formFactor: 'desktop',
    outputDir: join(dir, 'reports'),
    timeoutMs: 240_000
  })
  const elapsed = Math.round((Date.now() - started) / 1000)

  server.close()

  if (!result.ok) {
    console.log(`FAIL  denetim çalıştı — ${result.error}`)
    console.log('TOTAL=6 FAILED=1')
    app.exit(1)
    return
  }

  check('denetim çalıştı', true, `${elapsed}s`)
  check(
    'erişilebilirlik puanı var',
    typeof result.summary.scores.accessibility === 'number',
    String(result.summary.scores.accessibility)
  )
  check('seo puanı var', typeof result.summary.scores.seo === 'number', String(result.summary.scores.seo))
  check('denetim listesi dolu', result.summary.audits.length > 0, `${result.summary.audits.length} denetim`)
  check(
    'ham rapor yazıldı',
    !!result.raw.reportPath && existsSync(result.raw.reportPath),
    result.raw.reportPath ?? '-'
  )

  console.log('--- özet başlangıcı ---')
  console.log(result.raw.summary.split('\n').slice(0, 8).join('\n'))

  rmSync(dir, { recursive: true, force: true })

  console.log(`TOTAL=6 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
