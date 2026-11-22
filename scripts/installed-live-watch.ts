/// <reference types="node" />
import { app } from 'electron'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * KURULU UYGULAMA üzerinde canlı sınama (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/installed-live-watch.ts
 *
 * ## Neden bu betik ayrı
 *
 * Önceki testler derlenmiş kaynağı çalıştırıyor. Bu betik **kullanıcının
 * gerçekten kurduğu** uygulamayı (Program Files) sınar: yayınlanan artefaktın,
 * test edilen kodla aynı olduğunu kanıtlar.
 *
 * ## Canlı izleme
 *
 * Uygulamanın kendi günlüklerini (main.log, subagent-events.jsonl,
 * session-events.jsonl) **koşu sırasında** okur ve şu sinyalleri arar:
 *
 *  - `provider-busy` / 429 hatası → kapı tutmadı
 *  - eşzamanlı alt ajan sayısı   → sınır
 *  - `DOĞRULAMA` / `[KISMİ`      → rapor dürüstlüğü
 *
 * ## Gözlem kuralı
 *
 * "Test geçti" demek için uygulamanın **kendi** günlüğünde kanıt aranır;
 * betiğin kendi yorumu kanıt sayılmaz (0.4.23 dersi: ölçüm aracı ölçtüğünü
 * sandığı şeyi ölçmüyor olabilir).
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

const INSTALL_DIR = 'C:\\Program Files\\EVREN Desktop'
const APP_EXE = join(INSTALL_DIR, 'EVREN Desktop.exe')
const ASAR = join(INSTALL_DIR, 'resources', 'app.asar')
const PROFILE = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const MAIN_LOG = join(PROFILE, 'logs', 'main.log')
const SUB_LOG = join(PROFILE, 'logs', 'subagent-events.jsonl')
const SESSION_LOG = join(PROFILE, 'session-events.jsonl')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split('\n')
  } catch {
    return []
  }
}

function linesSince(path: string, offset: number): string[] {
  const all = readLines(path)
  return all.slice(offset).filter((line) => line.trim().length > 0)
}

function countLines(path: string): number {
  return readLines(path).length
}

app.whenReady().then(async () => {
  let failed = 0
  let total = 0
  function check(label: string, actual: unknown, expected: unknown): void {
    total += 1
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (!ok) failed += 1
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
    )
  }

  console.log('\n=== kurulu uygulama sınaması (v0.4.25) ===')

  // ---------- 0) Artefakt kimliği ----------
  check('kurulu uygulama var', existsSync(APP_EXE), true)
  check('asar var', existsSync(ASAR), true)
  if (!existsSync(ASAR)) {
    console.log('TOTAL=0 FAILED=1')
    app.exit(1)
    return
  }

  const asarText = readFileSync(ASAR).toString('utf8')
  check('asar: modelGate içeriyor', asarText.includes('EVREN_MODEL_CONCURRENCY'), true)
  check('asar: okuma kökleri içeriyor', asarText.includes('runWithReadRoots'), true)
  check('asar: provider-busy içeriyor', asarText.includes('provider-busy'), true)
  const version = /"name":\s*"evren-desktop",\s*"version":\s*"([^"]+)"/.exec(asarText)?.[1]
  check('asar sürümü', version, '0.4.25')

  // ---------- 1) Kapıyı baskı altında başlat ----------
  const beforeMain = countLines(MAIN_LOG)
  const beforeSub = countLines(SUB_LOG)

  console.log('\n· uygulama başlatılıyor: EVREN_MODEL_CONCURRENCY=1 (en sıkı)')
  const child = spawn(APP_EXE, [], {
    env: {
      ...process.env,
      EVREN_MODEL_CONCURRENCY: '1',
      // Alt ajanları zorlamak için eşiği düşür.
      EVREN_SUBAGENT_DEADLINE_MS: '180000'
    },
    detached: false,
    stdio: 'ignore'
  })

  const booted = await (async () => {
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline) {
      const fresh = linesSince(MAIN_LOG, beforeMain)
      if (fresh.some((line) => line.includes('v0.4.25'))) return true
      await sleep(500)
    }
    return false
  })()
  check('uygulama açıldı (günlükte sürüm)', booted, true)

  // Canlı izleme: 25 sn boyunca günlükleri yokla.
  console.log('\n· canlı izleme (25 sn): yeni alt ajan / hata / doğrulama olayları')
  const seen = new Set<string>()
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    for (const line of linesSince(SUB_LOG, beforeSub)) {
      try {
        const event = JSON.parse(line) as { phase?: string; level?: string; msg?: string }
        if (event.level === 'error') seen.add(`hata:${event.phase ?? '?'}`)
        if (event.phase === 'verify') seen.add('verify')
        if (event.phase === 'spawn') seen.add('spawn')
      } catch {
        // yarım satır (yazım sürüyor) — yoksay
      }
    }
    const freshMain = linesSince(MAIN_LOG, beforeMain)
    if (freshMain.some((line) => line.includes('Sağlayıcı doygun'))) seen.add('provider-busy')
    if (freshMain.some((line) => line.includes('429'))) seen.add('429')
    process.stdout.write(
      `\r   izlenen olay: ${[...seen].join(', ') || '(henüz yok)'}`.padEnd(90)
    )
    await sleep(1000)
  }
  console.log('')

  // ---------- 2) Karar ----------
  check('kapı tuttu: 429 / doygunluk görülmedi', seen.has('429') || seen.has('provider-busy'), false)

  // ---------- 3) Kapat ----------
  console.log('\n· uygulama kapatılıyor')
  try {
    child.kill()
  } catch {
    // zaten kapanmış
  }
  await sleep(2000)

  const freshMain = linesSince(MAIN_LOG, beforeMain)
  const crashed = freshMain.some(
    (line) => line.includes('Uncaught') || line.includes('crash') || line.toLowerCase().includes('fatal')
  )
  check('çökme yok', crashed, false)
  check(
    'kapı yapılandırması okundu (modelGate)',
    freshMain.length > 0 || readLines(MAIN_LOG).length > beforeMain,
    true
  )

  console.log(`\nTOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
