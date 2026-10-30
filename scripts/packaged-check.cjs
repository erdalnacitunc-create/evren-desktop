/**
 * Paketlenmiş uygulamada PTY ve xterm varlığını doğrular.
 *
 * Kullanım: node scripts/packaged-check.cjs "<win-unpacked yolu>"
 */
const { existsSync, readdirSync, statSync } = require('fs')
const { join } = require('path')

const root = process.argv[2]
if (!root) {
  console.error('Kullanım: node scripts/packaged-check.cjs <win-unpacked>')
  process.exit(2)
}

let failed = 0
function check(label, ok, detail) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const unpacked = join(root, 'resources', 'app.asar.unpacked')
const ptyDir = join(unpacked, 'node_modules', '@lydell', 'node-pty-win32-x64')

check('asar.unpacked var', existsSync(unpacked))
check('node-pty paketi açılmış', existsSync(ptyDir), ptyDir)

function find(dir, name, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) find(full, name, out)
    else if (entry === name) out.push(full)
  }
  return out
}

const nodeFiles = find(ptyDir, 'pty.node').concat(find(ptyDir, 'conpty.node'))
check('yerel ikili dosyalar var', nodeFiles.length >= 1, nodeFiles.map((f) => f.split('\\').pop()).join(', '))

const consoleHost = find(ptyDir, 'OpenConsole.exe')
check('ConPTY yardımcısı var', consoleHost.length >= 1)

const asar = join(root, 'resources', 'app.asar')
check('app.asar var', existsSync(asar))

console.log(`TOTAL=5 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
