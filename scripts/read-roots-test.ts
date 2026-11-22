/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  MAX_READ_ROOTS,
  deriveReadRoots,
  extractAbsolutePaths,
  type PathKind
} from '../src/main/agent/readRoots'

/**
 * Okuma kökü çıkarımı testleri (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/read-roots-test.ts
 *
 * ## Neden
 *
 * 0.4.24 canlı koşusunda sorgu masaüstündeki projeyi hedefliyordu ama
 * çalışma alanı boş bir geçici dizindi. Alt ajanlar hiçbir şey okuyamadı.
 * Artık kullanıcının mesajında açıkça yazdığı yollar **salt-okunur** açılır;
 * bu test kapsamın dar kaldığını doğrular (uydurma kök yok, sınırlı sayı).
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

app.whenReady().then(() => {
  // ============ 1) Windows yolu çıkarımı ============
  {
    check(
      'tek Windows yolu',
      extractAbsolutePaths('C:\\Users\\erdal\\Desktop\\proje klasörünü incele'),
      ['C:\\Users\\erdal\\Desktop\\proje']
    )
    check(
      'cümle noktalaması temizlenir',
      extractAbsolutePaths('bak: C:\\proje\\src\\a.ts, sonra devam.'),
      ['C:\\proje\\src\\a.ts']
    )
    check('sürücü kökü yok sayılır', extractAbsolutePaths('C:\\ diskini kontrol et'), [])
    check('tekrarlar atılır', extractAbsolutePaths('C:\\a\\b ve C:\\a\\b'), ['C:\\a\\b'])
    check(
      'iki farklı yol sırayla',
      extractAbsolutePaths('C:\\x\\y ile D:\\z\\q'),
      ['C:\\x\\y', 'D:\\z\\q']
    )
  }

  // ============ 2) POSIX yolu ============
  {
    check(
      'posix yolu',
      extractAbsolutePaths('/home/erdal/proje dosyalarını oku'),
      ['/home/erdal/proje']
    )
    check('tek parça posix yolu yok sayılır', extractAbsolutePaths('/tmp'), [])
  }

  // ============ 3) Var olmayan yol kök olmaz ============
  {
    const probe = (): PathKind => null
    check('var olmayan yol atlanır', deriveReadRoots('C:\\yok\\boyle\\bir\\yer', probe), [])
  }

  // ============ 4) Dosya → üst dizin ============
  {
    const probe = (path: string): PathKind =>
      path.toLowerCase().endsWith('a.ts') ? 'file' : path.toLowerCase().endsWith('src') ? 'dir' : null
    check(
      'dosya yolu üst dizine çevrilir',
      deriveReadRoots('C:\\proje\\src\\a.ts', probe),
      ['C:\\proje\\src']
    )
  }

  // ============ 5) Sınır: en fazla MAX_READ_ROOTS ============
  {
    const many = Array.from({ length: 9 }, (_, index) => `C:\\p${index}\\x`).join(' ')
    const probe = (): PathKind => 'dir'
    check('kök sayısı sınırlı', deriveReadRoots(many, probe).length, MAX_READ_ROOTS)
  }

  // ============ 6) Aynı yol farklı büyük/küçük harf → tek kök ============
  {
    const probe = (): PathKind => 'dir'
    check(
      'büyük/küçük harf tekrarı atılır',
      deriveReadRoots('C:\\Proje\\X ve c:\\proje\\x', probe),
      ['C:\\Proje\\X']
    )
  }

  // ============ 7) Metinde yol yoksa boş ============
  {
    check('yol yok', deriveReadRoots('sadece düz bir cümle', () => 'dir'), [])
    check('boş metin', deriveReadRoots('', () => 'dir'), [])
  }

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
