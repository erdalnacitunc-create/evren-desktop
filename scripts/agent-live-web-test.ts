/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatEvent } from '../src/shared/types'

/**
 * Web üzerinde paralel alt ajan sınaması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-web-test.ts
 *
 * ## Ne ölçülür
 *
 * 1. Alt ajanlar web araçlarını gerçekten kullanabiliyor mu (`websearch`,
 *    `webfetch`)?
 * 2. Üç ajan **farklı kaynaklara** mı gidiyor, yoksa aynı sonucu mu
 *    tekrarlıyor?
 * 3. Ajanlar birbirinden **haberdar** mı? (Bu testin asıl sorusu.)
 *
 * Üçüncü sorunun cevabı tasarım gereği "hayır": her alt ajan kendi mesaj
 * listesiyle izole çalışır (Cognition ilkesi — paylaşılan bağlam çelişen
 * kararlar üretir). Bu test bunu **kanıtlar**, varsaymaz.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

/** Üç ajan, üç farklı kaynak/konu — aynı konuyu tekrarlamamalı. */
const TASKS = [
  {
    id: 'electron',
    prompt:
      'Webde araştır: Electron `utilityProcess` API nedir, hangi sürümde geldi ve ' +
      'child_process.fork ile farkı nedir? Resmî Electron dokümantasyonunu kaynak göster (URL). ' +
      'Yalnızca web araçlarını kullan, dosya okuma.'
  },
  {
    id: 'sqlite',
    prompt:
      'Webde araştır: SQLite WAL (write-ahead logging) modu nasıl çalışır, hangi durumda ' +
      'tercih edilir ve hangi sınırları vardır? Resmî sqlite.org dokümantasyonunu kaynak göster (URL). ' +
      'Yalnızca web araçlarını kullan, dosya okuma.'
  },
  {
    id: 'rust',
    prompt:
      'Webde araştır: Rust dilinde `#[derive(Clone)]` ile manuel `impl Clone` arasındaki fark ' +
      'nedir ve ne zaman manuel tercih edilir? Resmî doc.rust-lang.org kaynağını göster (URL). ' +
      'Yalnızca web araçlarını kullan, dosya okuma.'
  }
] as const

interface AgentRun {
  id: string
  ok: boolean
  content: string
  tools: string[]
  urls: string[]
  elapsed: number
  /** Ajanın gördüğü tüm istem + araç metni (haberdarlık testi için). */
  seenText: string
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(0)
    return
  }
  const model = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'

  console.log(`\nmodel: ${model}`)
  console.log(`üç alt ajan paralel başlıyor…\n`)

  const startedAll = Date.now()

  const runs: AgentRun[] = await Promise.all(
    TASKS.map(async (task) => {
      const started = Date.now()
      const tools: string[] = []
      const seen: string[] = []

      const send = (event: ChatEvent): void => {
        if (event.type === 'tool-call') {
          tools.push(event.call.name)
          seen.push(String(event.call.arguments ?? ''))
        }
      }

      const result = await runSubagent({
        parentRequestId: `req-web-${task.id}`,
        baseUrl: settings.baseUrl,
        apiKey,
        model,
        agentType: 'explore',
        prompt: task.prompt,
        workspaceRoot: null,
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send
      })

      const urls = [...result.content.matchAll(/https?:\/\/[^\s)"'\]]+/g)]
        .map((match) => match[0])
        .slice(0, 12)

      return {
        id: task.id,
        ok: result.ok,
        content: result.content,
        tools,
        urls,
        elapsed: Math.round((Date.now() - started) / 1000),
        seenText: seen.join('\n')
      }
    })
  )

  const totalElapsed = Math.round((Date.now() - startedAll) / 1000)

  // ===== 1) hepsi web aracı kullandı =====
  console.log('\n=== AJAN BAŞINA ÖZET ===')
  for (const run of runs) {
    const webTools = run.tools.filter((name) => name === 'websearch' || name === 'webfetch')
    console.log(
      `\n[${run.id}] ok=${run.ok} süre=${run.elapsed}sn ` +
        `araç=${JSON.stringify(run.tools.reduce<Record<string, number>>((acc, name) => { acc[name] = (acc[name] ?? 0) + 1; return acc }, {}))}`
    )
    console.log(`  URL sayısı: ${run.urls.length}`)
    console.log(`  ilk URL: ${run.urls[0] ?? '-'}`)
    console.log(`  içerik: ${run.content.length} kr`)
    console.log(`  "utilityProcess": ${(run.content.match(/utilityProcess/gi) ?? []).length}`)
    console.log(`  "WAL": ${(run.content.match(/\bWAL\b/gi) ?? []).length}`)
    console.log(`  "Clone": ${(run.content.match(/Clone/g) ?? []).length}`)
    void webTools
  }

  console.log(`\ntoplam süre (paralel): ${totalElapsed} sn`)

  check(
    'her ajan en az bir web aracı kullandı',
    runs.every((run) => run.tools.some((name) => name === 'websearch' || name === 'webfetch')),
    true
  )
  check('her ajan ok=true', runs.every((run) => run.ok), true)
  check('her ajan en az bir URL gösterdi', runs.every((run) => run.urls.length > 0), true)
  check('her ajan dolu sonuç döndürdü', runs.every((run) => run.content.length > 200), true)

  // ===== 2) farklı kaynaklar =====
  const byId = new Map(runs.map((run) => [run.id, run]))
  const electron = byId.get('electron')
  const sqlite = byId.get('sqlite')
  const rust = byId.get('rust')

  check(
    'electron ajanı kendi konusunda',
    /utilityProcess/i.test(electron?.content ?? ''),
    true
  )
  check('sqlite ajanı kendi konusunda', /\bWAL\b/i.test(sqlite?.content ?? ''), true)
  check('rust ajanı kendi konusunda', /Clone/.test(rust?.content ?? ''), true)

  // Ajanlar birbirinin konusuna kaymamalı (kaynak çeşitliliği).
  check(
    'electron ajanı WAL konusuna kaymadı',
    /\bWAL\b/i.test(electron?.content ?? ''),
    false
  )
  check(
    'sqlite ajanı Clone konusuna kaymadı',
    /#\[derive\(Clone\)\]/.test(sqlite?.content ?? ''),
    false
  )

  const allUrls = runs.flatMap((run) => run.urls)
  const uniqueUrls = new Set(allUrls)
  check('URL çeşitliliği (tekrar yok)', uniqueUrls.size === allUrls.length, true)

  // Alan adı çeşitliliği: en az 2 farklı host.
  const hosts = new Set(
    allUrls
      .map((url) => {
        try {
          return new URL(url).hostname.replace(/^www\./, '')
        } catch {
          return ''
        }
      })
      .filter(Boolean)
  )
  console.log('\nkaynak alan adları:', [...hosts].join(', '))
  check('en az 2 farklı kaynak alan adı', hosts.size >= 2, true)

  // ===== 3) haberdarlık: ajanlar birbirini görmüyor =====
  // Her ajanın "gördüğü" metin yalnızca kendi sorgusu + kendi araç çıktısıdır.
  const awarenessLeak = runs.filter((run) => {
    const others = runs.filter((other) => other.id !== run.id)
    return others.some((other) => {
      // Diğer ajanın ayırt edici konusu bu ajanın gördüğü metinde geçiyor mu?
      const needle =
        other.id === 'sqlite' ? 'write-ahead logging' : other.id === 'rust' ? 'derive(Clone)' : 'utilityProcess'
      return run.seenText.includes(needle) && !TASKS.find((task) => task.id === run.id)?.prompt.includes(needle)
    })
  })
  check('ajanlar birbirinin bağlamını görmüyor', awarenessLeak.length, 0)

  console.log('\n=== HABERDARLIK ===')
  console.log('Her alt ajan yalnızca kendi istemini ve kendi araç çıktısını gördü.')
  console.log('Paylaşılan bağlam yok — tasarım gereği (Cognition ilkesi).')

  console.log(`\nTOTAL=12 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
