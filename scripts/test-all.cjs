/**
 * Tüm birim testlerini sırayla çalıştırır ve tek özet verir.
 *
 * Kullanım:
 *   node scripts/test-all.cjs            # tümü
 *   node scripts/test-all.cjs --fast     # yalnızca hızlı (Electron/Chrome/ağ gerektirmeyen) paketler
 *   node scripts/test-all.cjs agent      # adında "agent" geçenler
 *
 * Yeni bir test eklemek için aşağıdaki listeye yazmak yeterlidir.
 */
const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { join, resolve } = require('path')

const ROOT = resolve(__dirname, '..')

/** @type {Array<{ file: string, label: string, fast?: boolean }>} */
const SUITES = [
  { file: 'scripts/ipc-guard-test.ts', label: 'IPC gönderici doğrulaması' },
  { file: 'scripts/logger-test.ts', label: 'Günlük sır maskeleme' },
  { file: 'scripts/permission-test.ts', label: 'İzin kuralları', fast: true },
  { file: 'scripts/settings-rules-test.ts', label: 'Ayar doğrulama' },
  { file: 'scripts/prompt-history-test.ts', label: 'İstem geçmişi', fast: true },
  { file: 'scripts/steering-test.ts', label: 'Steering kuyruğu', fast: true },
  { file: 'scripts/steer-gate-test.ts', label: 'Steering kapısı' },
  { file: 'scripts/i18n-test.ts', label: 'i18n sözlükleri', fast: true },
  { file: 'scripts/pty-test.ts', label: 'Gerçek PTY' },
  { file: 'scripts/lighthouse-test.ts', label: 'Lighthouse özetleme', fast: true },
  { file: 'scripts/stream-tracker-test.ts', label: 'Akış biriktirici', fast: true },
  { file: 'scripts/session-store-test.ts', label: 'Oturum deposu' },
  { file: 'scripts/interaction-test.ts', label: 'Onay / soru köprüleri', fast: true },
  { file: 'scripts/workspace-scope-test.ts', label: 'Çalışma alanı kapsamı' },
  { file: 'scripts/event-sink-test.ts', label: 'Olay çıkış noktası', fast: true },
  { file: 'scripts/session-repository-test.ts', label: 'Oturum deposu arayüzü' },
  { file: 'scripts/agent-loop-test.ts', label: 'Ajan döngüsü (uçtan uca)' },
  { file: 'scripts/agent-concurrency-test.ts', label: 'Eşzamanlı ajan koşuları' }
]

const args = process.argv.slice(2)
const fastOnly = args.includes('--fast')
const filter = (args.find((arg) => !arg.startsWith('--')) ?? '').toLowerCase()

let selected = fastOnly ? SUITES.filter((suite) => suite.fast) : SUITES
if (filter) {
  selected = selected.filter(
    (suite) =>
      suite.file.toLowerCase().includes(filter) || suite.label.toLowerCase().includes(filter)
  )
}

if (selected.length === 0) {
  console.error(`Filtreyle eşleşen test yok: ${filter}${fastOnly ? ' (--fast)' : ''}`)
  process.exit(2)
}

const missing = selected.filter((suite) => !existsSync(join(ROOT, suite.file)))
if (missing.length > 0) {
  console.error(`Eksik test dosyası: ${missing.map((suite) => suite.file).join(', ')}`)
  process.exit(2)
}

let failedSuites = 0
let totalChecks = 0
let totalFailed = 0
const started = Date.now()

for (const suite of selected) {
  process.stdout.write(`\n\x1b[36m▶ ${suite.label}\x1b[0m (${suite.file})\n`)
  const run = spawnSync(process.execPath, ['scripts/run-unit.cjs', suite.file], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  process.stdout.write(output)

  const totalMatch = output.match(/TOTAL=(\d+) FAILED=(\d+)/)
  if (totalMatch) {
    totalChecks += Number(totalMatch[1])
    totalFailed += Number(totalMatch[2])
  }

  if (run.status !== 0) {
    failedSuites += 1
    process.stdout.write(`\x1b[31m✗ ${suite.label} başarısız (çıkış ${run.status})\x1b[0m\n`)
  } else {
    process.stdout.write(`\x1b[32m✓ ${suite.label}\x1b[0m\n`)
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
process.stdout.write(
  `\n${'-'.repeat(60)}\n` +
    `Paket: ${selected.length - failedSuites}/${selected.length} geçti · ` +
    `Kontrol: ${totalChecks - totalFailed}/${totalChecks} · ${seconds}s\n`
)
if (failedSuites > 0) {
  process.stdout.write(`\x1b[31m${failedSuites} paket başarısız\x1b[0m\n`)
  process.exit(1)
}
process.stdout.write('\x1b[32mTüm testler geçti\x1b[0m\n')
process.exit(0)
