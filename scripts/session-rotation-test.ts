/// <reference types="node" />
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  ROTATE_BYTES,
  ROTATE_KEEP,
  archiveName,
  archivesToDelete,
  rotateEventsFile,
  shouldRotate
} from '../src/main/sessionEventsRotation'

/**
 * Olay günlüğü döndürme testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/session-rotation-test.ts
 *
 * Neden: `session-events.jsonl` hiç küçülmüyordu. Canlı koşuda 4514 olay /
 * 1.1 MB üretti; aylar içinde onlarca MB olur ve `readEvents` yavaşlar.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// ============ 1) Karar fonksiyonu ============
{
  check('eşik altı', shouldRotate(1024), false)
  check('eşik tam', shouldRotate(ROTATE_BYTES), true)
  check('eşik üstü', shouldRotate(ROTATE_BYTES + 1), true)
  check('özel eşik altı', shouldRotate(99, 100), false)
  check('özel eşik tam', shouldRotate(100, 100), true)
  check('negatif boyut', shouldRotate(-1), false)
  check('NaN boyut', shouldRotate(Number.NaN), false)
  check('sıfır eşik', shouldRotate(10, 0), false)
  check('negatif eşik', shouldRotate(10, -5), false)
  check('varsayılan 8 MB', ROTATE_BYTES, 8 * 1024 * 1024)
  check('varsayılan keep 3', ROTATE_KEEP, 3)
}

// ============ 2) Arşiv adı ============
{
  const date = new Date('2026-11-02T12:34:56.789Z')
  const name = archiveName(date)
  check('ad biçimi', name, 'session-events.2026-11-02T12-34-56-789.jsonl')
  check('kronolojik sıralanır', archiveName(new Date('2026-01-01T00:00:00Z')) < archiveName(date), true)
  check(
    'dosya adında iki nokta yok',
    /:/.test(name),
    false
  )
  check('jsonl uzantısı', name.endsWith('.jsonl'), true)
}

// ============ 3) Silinecek arşivler ============
{
  const names = [
    'session-events.jsonl',
    'session-events.2026-01-01T00-00-00-000.jsonl',
    'session-events.2026-02-01T00-00-00-000.jsonl',
    'session-events.2026-03-01T00-00-00-000.jsonl',
    'session-events.2026-04-01T00-00-00-000.jsonl',
    'başka-dosya.jsonl',
    'sessions.json'
  ]
  const stale = archivesToDelete(names, 3)
  check('en yeni 3 tutulur', stale.length, 1)
  check('en eski silinir', stale[0], 'session-events.2026-01-01T00-00-00-000.jsonl')

  check('arşiv yoksa silme yok', archivesToDelete(['session-events.jsonl'], 3), [])
  check('tam 3 arşiv', archivesToDelete(names.slice(1, 4), 3), [])
  check('keep=1', archivesToDelete(names.slice(1, 4), 1).length, 2)
  check('keep=0 hepsi', archivesToDelete(names.slice(1, 4), 0).length, 3)
}

// ============ 4) Gerçek dosyayla döndürme ============
const base = join(process.env.EVREN_TEST_DATA as string, 'rotation')
rmSync(base, { recursive: true, force: true })
mkdirSync(base, { recursive: true })

const file = join(base, 'session-events.jsonl')

async function main(): Promise<void> {
  // --- 4a) eşik altı: dokunulmaz ---
  writeFileSync(file, '{"seq":1}\n', 'utf8')
  const skipped = await rotateEventsFile(file, { limit: 1024 })
  check('küçük dosya döndürülmedi', skipped, null)
  check('dosya yerinde', readdirSync(base).includes('session-events.jsonl'), true)

  // --- 4b) eşik aşımı: arşivlenir, yeni dosya oluşmaz ama okuma boş ---
  writeFileSync(file, 'x'.repeat(2048), 'utf8')
  const archived = await rotateEventsFile(file, { limit: 1024 })
  check('döndürüldü', archived !== null, true)
  check('arşiv adı jsonl', (archived ?? '').endsWith('.jsonl'), true)
  const namesAfter = readdirSync(base)
  check('arşiv dosyası var', namesAfter.includes(archived ?? ''), true)
  check('ana dosya gitti', namesAfter.includes('session-events.jsonl'), false)
  check('arşiv boyutu korundu', (await import('fs')).statSync(join(base, archived ?? '')).size, 2048)

  // --- 4c) keep sınırı: eskiler silinir ---
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  for (const stamp of ['2026-01-01T00-00-00-000', '2026-02-01T00-00-00-000', '2026-03-01T00-00-00-000']) {
    writeFileSync(join(base, `session-events.${stamp}.jsonl`), 'old', 'utf8')
  }
  writeFileSync(file, 'y'.repeat(2048), 'utf8')
  const rotated = await rotateEventsFile(file, { limit: 1024, keep: 2 })
  const finalNames = readdirSync(base).filter((name) => name.startsWith('session-events.'))
  check('keep=2 → 2 arşiv', finalNames.length, 2)
  check('en yeni arşiv kaldı', finalNames.includes(rotated ?? ''), true)
  check('en eski silindi', finalNames.includes('session-events.2026-01-01T00-00-00-000.jsonl'), false)

  // --- 4d) dosya yoksa hata vermez ---
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  const missing = await rotateEventsFile(join(base, 'yok.jsonl'), { limit: 1 })
  check('olmayan dosya güvenli', missing, null)

  console.log(`TOTAL=32 FAILED=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
