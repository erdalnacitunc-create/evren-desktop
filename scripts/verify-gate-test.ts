/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  excerpt,
  formatVerifyVerdict,
  isMutatingTool,
  runVerifyGate,
  shouldVerify,
  verifyRetryMessage,
  type VerifyVerdict
} from '../src/main/agent/verifyGate'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * Doğrulama kapısı testleri (0.4.24).
 * Çalıştırma: node scripts/run-unit.cjs scripts/verify-gate-test.ts
 *
 * ## Neden
 *
 * Tekrarlayan kusur sınıfı: **başarısızlığı başarı gibi raporlamak**.
 * `general` alt ajanı dosya yazıp "tamamlandı" diyordu; typecheck/test
 * çalışmıyordu. Kapı bunu deterministik olarak kapatır (Claude Code `Stop`
 * hook karşılığı).
 *
 * ## Testin koruduğu üç kural
 *
 * 1. Yalnızca yazma olduysa ve ajan yazabiliyorsa çalışır (maliyet sınırı).
 * 2. Kontrol tanımlı/yürütülebilir değilse **"doğrulanmadı"** der, "geçti" demez.
 * 3. Başarısızlıkta modele giden istem, testi/kontrolü gevşetmeyi açıkça yasaklar.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

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
function contains(label: string, text: string, needle: string, expected = true): void {
  total += 1
  const ok = text.includes(needle) === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

function verdict(partial: Partial<VerifyVerdict>): VerifyVerdict {
  return { ran: true, ok: true, checks: [], durationMs: 1200, ...partial }
}

function writeProject(root: string, exitCode: number): void {
  writeFileSync(join(root, 'check.js'), `process.exit(${exitCode})\n`, 'utf8')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'gate-fixture', scripts: { test: 'node check.js' } }, null, 2),
    'utf8'
  )
}

app.whenReady().then(async () => {
  // ============ 1) Yazma aracı tespiti ============
  {
    for (const name of ['write_file', 'edit_file', 'patch', 'delete_file', 'create_directory', 'run_command', 'run_python']) {
      check(`yazma aracı: ${name}`, isMutatingTool(name), true)
    }
    for (const name of ['read_file', 'grep', 'run_checks', 'task_wait', 'webfetch']) {
      check(`yazma değil: ${name}`, isMutatingTool(name), false)
    }
  }

  // ============ 2) Kapı ne zaman çalışır ============
  {
    check('salt-okunur ajan → çalışmaz', shouldVerify({ readOnly: true, mutations: 3, mode: 'auto' }), false)
    check('yazma yok → çalışmaz', shouldVerify({ readOnly: false, mutations: 0, mode: 'auto' }), false)
    check('yazma var → çalışır', shouldVerify({ readOnly: false, mutations: 1, mode: 'auto' }), true)
    check('mod off → çalışmaz', shouldVerify({ readOnly: false, mutations: 2, mode: 'off' }), false)
  }

  // ============ 3) Çıktı kısaltma ============
  {
    check('kısa çıktı korunur', excerpt('abc', 10), 'abc')
    const long = excerpt('x'.repeat(50), 10)
    contains('uzun çıktı kesilir', long, 'kısaltıldı')
    check('kısaltma sınırı', long.startsWith('x'.repeat(10)), true)
  }

  // ============ 4) Rapor biçimi: geçti ============
  {
    const text = formatVerifyVerdict(
      verdict({
        checks: [
          { id: 'typecheck', label: 'Typecheck', command: 'npm run typecheck', ok: true, exitCode: 0, output: '' },
          { id: 'test', label: 'Test', command: 'npm run test', ok: true, exitCode: 0, output: '' }
        ]
      })
    )
    contains('geçti işareti', text, '✓ geçti')
    contains('kontrol adları', text, 'Typecheck, Test')
  }

  // ============ 5) Rapor biçimi: başarısız ============
  {
    const text = formatVerifyVerdict(
      verdict({
        ok: false,
        checks: [
          { id: 'typecheck', label: 'Typecheck', command: 'npm run typecheck', ok: false, exitCode: 2, output: 'src/a.ts(3,1): error TS1' }
        ]
      })
    )
    contains('başarısız işareti', text, 'BAŞARISIZ')
    contains('komut adı', text, 'npm run typecheck')
    contains('çıkış kodu', text, 'çıkış 2')
    contains('hata çıktısı', text, 'error TS1')
  }

  // ============ 6) Ölçülemedi → başarı göstermez ============
  {
    const noChecks = formatVerifyVerdict(verdict({ ran: false, ok: false, reason: 'no-checks' }))
    contains('kontrol yoksa doğrulanmadı', noChecks, 'doğrulanmadı')
    contains('kontrol yoksa geçti demez', noChecks, 'geçti', false)

    const crashed = formatVerifyVerdict(
      verdict({ ran: false, ok: false, reason: 'error', error: 'spawn ENOENT' })
    )
    contains('kapı çöktüyse çalıştırılamadı', crashed, 'çalıştırılamadı')
    contains('kapı çöktüyse hata nedeni', crashed, 'spawn ENOENT')
    contains('kapı çöktüyse geçti demez', crashed, 'geçti', false)
  }

  // ============ 7) Düzeltme istemi oyunlaştırmayı yasaklar ============
  {
    const message = verifyRetryMessage(
      verdict({
        ok: false,
        checks: [
          { id: 'test', label: 'Test', command: 'npm run test', ok: false, exitCode: 1, output: 'fail' }
        ]
      })
    )
    contains('düzeltme istemi başarısızlığı taşır', message, 'BAŞARISIZ')
    contains('testi silmeyi yasaklar', message, 'silme')
    contains('gevşetmeyi yasaklar', message, 'gevşetme')
    contains('doğrulanamadı seçeneği', message, 'doğrulanamadı')
  }

  // ============ 8) Gerçek kapı: geçen proje ============
  const base = join(dataDir, 'verify-gate')
  rmSync(base, { recursive: true, force: true })

  {
    const passing = join(base, 'passing')
    mkdirSync(passing, { recursive: true })
    writeProject(passing, 0)
    const result = await runWithWorkspace(passing, () => runVerifyGate(['test']))
    check('geçen projede kapı çalıştı', result.ran, true)
    check('geçen projede sonuç ok', result.ok, true)
    check('geçen projede tek kontrol', result.checks.length, 1)
    contains('geçen raporda ✓', formatVerifyVerdict(result), '✓ geçti')
  }

  // ============ 9) Gerçek kapı: başarısız proje ============
  {
    const failing = join(base, 'failing')
    mkdirSync(failing, { recursive: true })
    writeProject(failing, 3)
    const result = await runWithWorkspace(failing, () => runVerifyGate(['test']))
    check('başarısız projede kapı çalıştı', result.ran, true)
    check('başarısız projede sonuç ok değil', result.ok, false)
    check('başarısız projede çıkış kodu sıfır değil', (result.checks[0]?.exitCode ?? 0) !== 0, true)
    contains('başarısız raporda ✗', formatVerifyVerdict(result), 'BAŞARISIZ')
  }

  // ============ 10) Gerçek kapı: kontrol tanımsız ============
  {
    const empty = join(base, 'empty')
    mkdirSync(empty, { recursive: true })
    const result = await runWithWorkspace(empty, () => runVerifyGate(['test']))
    check('kontrolsüz projede kapı çalışmadı', result.ran, false)
    check('kontrolsüz projede neden', result.reason, 'no-checks')
    contains('kontrolsüz projede dürüst rapor', formatVerifyVerdict(result), 'doğrulanmadı')
  }

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
