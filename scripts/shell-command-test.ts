/// <reference types="node" />
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runWorkspaceCommand, runWithWorkspace } from '../src/main/workspace'

/**
 * run_command kabuk testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/shell-command-test.ts
 *
 * Modelin ürettiği zor komutlar (-EncodedCommand sayesinde) bozulmadan
 * çalışmalı: tırnak, $ değişkeni, çok satır, tek tırnak, Unicode.
 */
let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const root = join(process.env.EVREN_TEST_DATA ?? process.cwd(), 'shell-ws')
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })

void (async () => {
  const run = (command: string, timeoutMs = 30_000) =>
    runWithWorkspace(root, () => runWorkspaceCommand(command, { timeoutMs }))

  // --- temel ---
  const simple = await run('Write-Output "merhaba"')
  check('basit komut çıkış kodu', simple.exitCode, 0)
  check('basit komut çıktısı', simple.stdout.trim(), 'merhaba')

  // --- değişken + çok satır ---
  const multi = await run('$a = 2\n$b = 3\nWrite-Output ($a * $b)')
  check('çok satırlı script', multi.stdout.trim(), '6')

  // --- tırnak içinde tırnak ---
  const quoted = await run(`Write-Output ('O''Brien dedi: "selam"')`)
  check('iç içe tırnak', quoted.stdout.trim(), `O'Brien dedi: "selam"`)

  // --- tek tırnak / süslü parantez / boru ---
  const pipeline = await run(
    '@("a","b","c") | Where-Object { $_ -ne "b" } | ForEach-Object { Write-Output "harf=$_" }'
  )
  check('boru ve blok', pipeline.stdout.replace(/\r/g, '').trim().split('\n').map((l) => l.trim()), [
    'harf=a',
    'harf=c'
  ])

  // --- Türkçe karakterler ---
  const turkish = await run('Write-Output "çğıöşü ÇĞİÖŞÜ"')
  check('Türkçe karakterler bozulmaz', turkish.stdout.trim(), 'çğıöşü ÇĞİÖŞÜ')

  // --- hata çıkış kodu ---
  const failing = await run('Write-Error "kasıtlı hata"; exit 3')
  check('hata çıkış kodu', failing.exitCode, 3)
  check('hata metni', failing.stderr.includes('kasıtlı') || failing.stdout.includes('kasıtlı'), true)

  // --- uzun script (komut satırı sınırına yakın) ---
  const longCommand = Array.from({ length: 200 }, (_, i) => `$v${i} = ${i}`).join('\n') + '\nWrite-Output $v199'
  const long = await run(longCommand)
  check('uzun script çalışır', long.stdout.trim(), '199')

  // --- dosya yazma/okuma ---
  const fileOp = await run('"içerik" | Set-Content -Path deneme.txt -Encoding UTF8; Get-Content deneme.txt')
  check('dosya işlemi', fileOp.stdout.trim(), 'içerik')

  // --- çalışma alanı dışına çıkmaz (cwd doğru) ---
  const pwd = await run('(Get-Location).Path')
  check('çalışma klasörü', pwd.stdout.trim().toLowerCase(), root.toLowerCase())

  // --- zaman aşımı ---
  const slow = await run('Start-Sleep -Seconds 5', 1200)
  check('zaman aşımı yakalanır', slow.exitCode, 124)

  console.log(`TOTAL=15 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
})()
