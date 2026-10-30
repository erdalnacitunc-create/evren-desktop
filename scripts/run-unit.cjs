/**
 * TypeScript test yardımcısı.
 *
 * Verilen .ts dosyasını geçici bir klasöre derler ve Electron ile çalıştırır.
 * Testler `electron` modülüne ihtiyaç duyduğu için Node yerine Electron gerekir.
 *
 * Kullanım: node scripts/run-unit.cjs scripts/ipc-guard-test.ts
 */
const { spawnSync } = require('child_process')
const { existsSync, mkdirSync, mkdtempSync, rmSync } = require('fs')
const { join, resolve } = require('path')

const entry = process.argv[2]
if (!entry) {
  console.error('Kullanım: node scripts/run-unit.cjs <test.ts>')
  process.exit(2)
}

const root = resolve(__dirname, '..')
const source = resolve(root, entry)
if (!existsSync(source)) {
  console.error(`Test dosyası yok: ${source}`)
  process.exit(2)
}

// Derleme çıktısı proje ağacının içinde kalmalı; aksi halde Electron
// `electron-log` gibi bağımlılıkları çözemez.
const cacheDir = join(root, 'node_modules', '.cache')
mkdirSync(cacheDir, { recursive: true })
const outDir = mkdtempSync(join(cacheDir, 'evren-unit-'))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const electronBinary = require('electron')

const compile = spawnSync(
  process.execPath,
  [
    tsc,
    source,
    '--ignoreConfig',
    '--outDir',
    outDir,
    '--rootDir',
    root,
    '--module',
    'commonjs',
    '--target',
    'es2022',
    '--esModuleInterop',
    '--skipLibCheck'
  ],
  { stdio: 'inherit', cwd: root }
)
if (compile.status !== 0) {
  rmSync(outDir, { recursive: true, force: true })
  process.exit(compile.status ?? 1)
}

const compiled = join(outDir, entry.replace(/\.ts$/, '.js'))
if (!existsSync(compiled)) {
  console.error(`Derlenmiş test bulunamadı: ${compiled}`)
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

const dataDir = join(outDir, 'user-data')
const run = spawnSync(electronBinary, [compiled], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, EVREN_TEST_DATA: dataDir, EVREN_DATA_DIR: dataDir }
})

rmSync(outDir, { recursive: true, force: true })
process.exit(run.status ?? 1)
