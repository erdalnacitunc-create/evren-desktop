/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hasPowerShellVariables, unwrapNestedPowerShell } from '../src/main/commandShell'
import { runWithWorkspace, runWorkspaceCommand } from '../src/main/workspace'

/**
 * Komut yürütme kabuğu testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/command-shell-test.ts
 *
 * Canlı koşuda gözlendi: model `powershell -Command "… $_.InstanceId …"`
 * yazdı; dış katman `$_`'yi boşalttı ve komut
 * "The term '.InstanceId' is not recognized" ile düştü.
 * Artık sarmalayıcı çözülüp iç betik doğrudan çalıştırılıyor.
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

// ============ 1) Canlı koşudaki gerçek hatanın çözümü ============
{
  const failing =
    'powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like \'USB*\' } | Select-Object FriendlyName"'
  const unwrapped = unwrapNestedPowerShell(failing)
  check('sarmalayıcı çözüldü', unwrapped !== null, true)
  check(
    'iç betik korundu',
    unwrapped,
    "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB*' } | Select-Object FriendlyName"
  )
  check('$_ korundu', unwrapped?.includes('$_.InstanceId'), true)
  check('powershell sözcüğü gitti', /\bpowershell\b/i.test(unwrapped ?? ''), false)
}

// ============ 2) Bayrak biçimleri ============
{
  check(
    'pwsh -c',
    unwrapNestedPowerShell('pwsh -NoProfile -c "Get-Process | Where-Object { $_.CPU -gt 1 }"'),
    'Get-Process | Where-Object { $_.CPU -gt 1 }'
  )
  check(
    'tam yol powershell.exe',
    unwrapNestedPowerShell(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command "Write-Output $env:PATH"'
    ),
    'Write-Output $env:PATH'
  )
  check(
    '& operatörü',
    unwrapNestedPowerShell('& powershell -Command "Write-Output $env:PATH"'),
    'Write-Output $env:PATH'
  )
  check(
    '-Command: bitişik biçim',
    unwrapNestedPowerShell('powershell -Command:"Write-Output $env:PATH"'),
    'Write-Output $env:PATH'
  )
  check(
    'kaçışlı tırnak normalleşti',
    unwrapNestedPowerShell('powershell -Command "Write-Output \\"merhaba\\""'),
    'Write-Output "merhaba"'
  )
  check(
    'ikili tırnak kaçışı',
    unwrapNestedPowerShell('powershell -Command "Write-Output ""merhaba"""'),
    'Write-Output "merhaba"'
  )
  check(
    'tek tırnaklı sarmalama',
    unwrapNestedPowerShell("powershell -Command 'Get-ChildItem'"),
    'Get-ChildItem'
  )
  check(
    'tırnaksız tek satır',
    unwrapNestedPowerShell('powershell -Command Get-ChildItem'),
    'Get-ChildItem'
  )
}

// ============ 3) Çözülmemesi gerekenler ============
{
  check('düz komut', unwrapNestedPowerShell('Get-ChildItem -Recurse'), null)
  check('boş komut', unwrapNestedPowerShell(''), null)
  check('boşluk', unwrapNestedPowerShell('   '), null)
  check(
    '-File çözülmez',
    unwrapNestedPowerShell('powershell -NoProfile -ExecutionPolicy Bypass -File scan_usb.ps1'),
    null
  )
  check(
    'kısmi sarmalama dokunulmaz',
    unwrapNestedPowerShell('cd C:\\Temp; powershell -Command "Write-Output $PSVersionTable"'),
    null
  )
  check(
    'zincirleme sarmalama dokunulmaz',
    unwrapNestedPowerShell('powershell -Command "powershell -Command \\"Get-Date\\""'),
    null
  )
  check('powershell kelimesi metin içinde', unwrapNestedPowerShell('echo "powershell kullanma"'), null)
  check('iç betik boş', unwrapNestedPowerShell('powershell -Command ""'), null)
}

// ============ 4) Değişken tespiti ============
{
  check('$_ yakalanır', hasPowerShellVariables('Where-Object { $_.Status -eq "OK" }'), true)
  check('$env yakalanır', hasPowerShellVariables('echo $env:PATH'), true)
  check('$var yakalanır', hasPowerShellVariables('$x = 1'), true)
  check('alt ifade yakalanır', hasPowerShellVariables('$(Get-Date)'), true)
  check('değişken yok', hasPowerShellVariables('Get-ChildItem C:\\'), false)
}

// ============ 5) Gerçek yürütme ============
app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'shell')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'bir.txt'), 'x', 'utf8')
  writeFileSync(join(base, 'iki.txt'), 'y', 'utf8')

  await runWithWorkspace(base, async () => {
    // Düz PowerShell: değişken dış katmanda açılır (beklenen).
    const direct = await runWorkspaceCommand('Write-Output "düz:$($PSVersionTable.PSVersion.Major)"')
    check('düz komut çalıştı', direct.exitCode, 0)
    check('düz komut çıktısı', /^düz:\d/m.test(direct.stdout), true)

    // Canlı koşudaki hata: iç içe sarmalama + $_
    const nested = await runWorkspaceCommand(
      'powershell -NoProfile -Command "Get-ChildItem -File | Where-Object { $_.Name -like \'*.txt\' } | Measure-Object | Select-Object -ExpandProperty Count"'
    )
    check('iç içe komut çalıştı', nested.exitCode, 0)
    check('$_ korundu (hata yok)', /not recognized|tanınmıyor/i.test(nested.stderr), false)
    check('iç içe sonuç 2', nested.stdout.trim(), '2')

    // İç içe komutta çıkış kodu korunur.
    const nestedFail = await runWorkspaceCommand('powershell -Command "exit 7"')
    check('iç içe çıkış kodu 7', nestedFail.exitCode, 7)

    // Türkçe karakterler bozulmamalı (UTF-8 zorlaması).
    const turkish = await runWorkspaceCommand('Write-Output "ğüşiöçİĞÜŞÖÇ"')
    check('Türkçe çıktı bozulmadı', turkish.stdout.includes('ğüşiöçİĞÜŞÖÇ'), true)

    // Çok satırlı betik.
    const multiline = await runWorkspaceCommand('$a = 2\n$b = 3\nWrite-Output ($a * $b)')
    check('çok satırlı betik', multiline.stdout.trim(), '6')

    // Çıkış kodu korunur.
    const failing = await runWorkspaceCommand('exit 3')
    check('çıkış kodu 3', failing.exitCode, 3)

    // Ağır tırnak içeren komut.
    const quoted = await runWorkspaceCommand(
      'Write-Output "tek \'çift \"üçlü\"\' son"'
    )
    check('ağır tırnak', quoted.stdout.includes('üçlü'), true)
  })

  console.log(`TOTAL=30 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
