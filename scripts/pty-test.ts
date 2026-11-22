/// <reference types="node" />
import { app } from 'electron'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { interruptPty, ptyStatus, resizePty, startPty, stopPty, writePty } from '../src/main/pty'

/**
 * PTY oturumu testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/pty-test.ts
 *
 * Gerçek bir kabuk açar; komutun gerçekten çalıştığını kabuğun yazdığı
 * dosyayla doğrular (çıktı kanalı pencere gerektirdiği için dosya kullanılır).
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await sleep(100)
  }
  return false
}

/**
 * Dosyayı **beklenen içerikle** bekler (0.4.25).
 *
 * ## Neden
 *
 * Tam pakette yarış ortaya çıktı: `waitForFile` yalnızca dosyanın **varlığına**
 * bakıyordu. Shell dosyayı oluşturup yönlendirme tamponunu henüz boşaltmadan
 * test içeriği okuyordu; sonuç "dosya oluştu ✓, içerik boş ✗" oluyordu.
 *
 * Bu bir ürün hatası değil, **testin kendi yarışıydı** — ama tam olarak
 * kapatmaya çalıştığımız sınıf: ölçüm aracı ölçtüğünü sandığı şeyi ölçmüyor.
 * Artık içerik gelene kadar beklenir; gelmezse test açıkça başarısız olur.
 */
async function waitForContent(
  path: string,
  expected: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const raw = readFileSync(path)
      const isUtf16 = raw.includes(0)
      const text = (isUtf16 ? raw.toString('utf16le') : raw.toString('utf8'))
        .replace(/^\uFEFF/, '')
        .trim()
      if (text.includes(expected)) return text
    } catch {
      // henüz yok / okunamıyor
    }
    await sleep(100)
  }
  return ''
}

app.whenReady().then(async () => {
  const cwd = process.cwd()
  const marker = join(cwd, 'node_modules', '.cache', `pty-marker-${process.pid}.txt`)
  rmSync(marker, { force: true })

  const status0 = ptyStatus()
  check('başlangıçta çalışmıyor', status0.running, false)
  check('mod pty', status0.mode, 'pty')

  const started = await startPty({ cwd, cols: 100, rows: 30 })
  check('oturum başladı', started.running, true)
  check('mod pty (çalışıyor)', started.mode, 'pty')
  check('klasör doğru', started.cwd, cwd)

  check('yeniden başlatma yok (reuse)', (await startPty({ cwd })).running, true)

  const command =
    process.platform === 'win32'
      ? `echo PTY_MARKER > "${marker}"\r`
      : `echo PTY_MARKER > "${marker}"\n`
  check('komut yazıldı', writePty(command), true)

  const created = await waitForFile(marker, 8000)
  check('komut gerçekten çalıştı (dosya oluştu)', created, true)
  // İçerik, yönlendirme tamponu boşalana kadar boş olabilir; bekle.
  const text = created ? await waitForContent(marker, 'PTY_MARKER', 5000) : ''
  check('dosya içeriği doğru', text, 'PTY_MARKER')


  check('oturum hâlâ çalışıyor', ptyStatus().running, true)
  check('yeniden boyutlandırma', resizePty(120, 40), true)
  check('geçersiz boyut kırpılır', resizePty(-5, 10000), true)
  check('boş yazma reddedilir', writePty(''), false)
  check('kesme gönderilir', interruptPty(), true)
  await sleep(800)
  check('kesme sonrası çalışıyor', ptyStatus().running, true)

  stopPty()
  check('durduruldu', ptyStatus().running, false)
  check('durdurulduktan sonra yazma reddedilir', writePty('x'), false)
  rmSync(marker, { force: true })

  console.log(`TOTAL=16 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
