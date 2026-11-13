/// <reference types="node" />
import { app } from 'electron'
import { outsideWorkspaceHint } from '../src/main/agent/loop'

/**
 * Çalışma alanı dışı ipucu testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/outside-workspace-hint-test.ts
 *
 * ## Canlı kusur (0.4.10, plc_proje koşusu)
 *
 * Çalışma alanı geçici klasördü (evren-workspaces\mwekjvxv…), kullanıcı ise
 * masaüstündeki `plc_proje` klasörünü sordu. Model `read_file` denedi:
 *
 *   Araç hatası: ENOENT … evren-workspaces\mwekjvxv-5e451733\00_genel_felsefe.md
 *
 * Çünkü read_file göreli yolu çalışma alanına göre çözer ve kapsam dışına
 * çıkamaz. Model PowerShell'e düşerek devam etti (1 kayıp adım).
 * Artık istem baştan söylüyor: dış yollar için run_command + mutlak yol.
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

const ROOT = 'C:\\Users\\erdal\\AppData\\Local\\Temp\\evren-workspaces\\abc'

// ============ 1) Canlı koşudaki sorgu ============
{
  const hint = outsideWorkspaceHint(ROOT, 'masaüstünde bulunan plc_proje klasörü içindeki projeyi incele')
  check('masaüstü ifadesi yakalandı', hint.length > 0, true)
  check('run_command öneriliyor', hint.includes('run_command'), true)
  check('mutlak yol vurgusu', /mutlak yol/i.test(hint), true)
  check('read_file denemeyin diyor', /read_file denemeyin/i.test(hint), true)
  check('örnek komut var', hint.includes('Get-Content'), true)
}

// ============ 2) Mutlak Windows yolu ============
{
  const hint = outsideWorkspaceHint(ROOT, 'C:\\Users\\erdal\\Desktop\\plc_proje klasörünü incele')
  check('sürücü harfi yakalandı', hint.length > 0, true)
}

// ============ 3) Linux mutlak yolu ============
{
  const hint = outsideWorkspaceHint('/home/erdal/work', 'read /opt/proje/README.md')
  check('linux yolu yakalandı', hint.length > 0, true)
}

// ============ 4) Diğer klasör adları ============
{
  check('desktop', outsideWorkspaceHint(ROOT, 'the desktop folder').length > 0, true)
  check('indirilenler', outsideWorkspaceHint(ROOT, 'indirilenler klasörü').length > 0, true)
  check('documents', outsideWorkspaceHint(ROOT, 'documents klasörü').length > 0, true)
}

// ============ 5) Tetiklenmemesi gerekenler ============
{
  check('sade çalışma alanı sorusu', outsideWorkspaceHint(ROOT, 'src klasörünü incele'), '')
  check('dosya adı', outsideWorkspaceHint(ROOT, 'package.json içeriğini oku'), '')
  check('boş sorgu', outsideWorkspaceHint(ROOT, ''), '')
  check('çalışma alanı yok', outsideWorkspaceHint(null, 'masaüstü klasörü'), '')
}

// ============ 6) Metin kalitesi ============
{
  const hint = outsideWorkspaceHint(ROOT, 'masaüstü')
  check('başlık var', hint.includes('ÇALIŞMA ALANI DIŞI'), true)
  check('kapsam kuralını açıklıyor', /yalnızca çalışma alanı içinde/.test(hint), true)
  check('güvenlik gerekçesi', /güvenlik/.test(hint), true)
  check('Klasör Seç önerisi', /Klasör Seç/.test(hint), true)
  check('newline ile başlıyor', hint.startsWith('\n\n'), true)
}

// ============ 7) Deterministik ============
{
  const a = outsideWorkspaceHint(ROOT, 'masaüstü projesi')
  const b = outsideWorkspaceHint(ROOT, 'masaüstü projesi')
  check('aynı girdi aynı çıktı', a, b)
}

console.log(`TOTAL=19 FAILED=${failed}`)
app.exit(failed === 0 ? 0 : 1)
