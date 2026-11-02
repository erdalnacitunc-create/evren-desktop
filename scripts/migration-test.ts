/// <reference types="node" />
import {
  STORE_VERSION,
  migrateStore,
  normalizeRetry,
  serializeStore
} from '../src/main/sessionMigration'
import type { Session } from '../src/shared/types'

/**
 * Oturum deposu göçü ve kalıcı retry testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/migration-test.ts
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

// ============ 1) Eski biçim (düz dizi) ============
{
  const legacy = [
    {
      id: 's1',
      title: 'Eski oturum',
      modelId: 'm1',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'a', role: 'user', content: 'merhaba', createdAt: 1000 },
        { id: 'b', role: 'assistant', content: 'selam', reasoning: 'düşünce', createdAt: 1100 }
      ]
    }
  ]
  const { store, report } = migrateStore(legacy)

  check('v1 algılandı', report.fromVersion, 1)
  check('hedef sürüm', report.toVersion, STORE_VERSION)
  check('oturum sayısı', report.sessions, 1)
  check('mesaj sayısı', report.messages, 2)
  check('bozuk kayıt yok', report.skipped, 0)
  check('başlık korundu', store.sessions[0]?.title, 'Eski oturum')
  check('içerik korundu', store.sessions[0]?.messages[0]?.content, 'merhaba')
  check('reasoning korundu', store.sessions[0]?.messages[1]?.reasoning, 'düşünce')
}

// ============ 2) Yeni biçim (version + sessions) ============
{
  const modern = {
    version: STORE_VERSION,
    sessions: [
      {
        id: 's2',
        title: 'Yeni',
        modelId: 'm2',
        createdAt: 1,
        updatedAt: 2,
        messages: []
      }
    ]
  }
  const { store, report } = migrateStore(modern)
  check('v2 algılandı', report.fromVersion, STORE_VERSION)
  check('oturum korundu', store.sessions.length, 1)
}

// ============ 3) Bozuk kayıtlar tüm dosyayı düşürmez ============
{
  const mixed = [
    { id: 'ok', title: 'Sağlam', modelId: 'm', createdAt: 1, updatedAt: 1, messages: [] },
    { title: 'kimliksiz', modelId: 'm', createdAt: 1, updatedAt: 1, messages: [] },
    'metin',
    null
  ]
  const { store, report } = migrateStore(mixed)
  check('sağlam oturum kaldı', store.sessions.length, 1)
  check('bozuklar atlandı', report.skipped, 3)
  check('göç notları var', report.notes.length >= 3, true)
}

// ============ 4) Eksik alan onarımı ============
{
  const broken = [
    {
      id: 's3',
      modelId: 'm',
      messages: [
        { role: 'user' }, // içerik, id, createdAt yok
        { role: 'gecersiz', content: 'x' }, // geçersiz rol
        { id: 'c', role: 'assistant', content: 'tamam', createdAt: 5 }
      ]
    }
  ]
  const { store, report } = migrateStore(broken)
  const session = store.sessions[0]
  check('eksik başlık varsayılan', session?.title, 'Yeni sohbet')
  check('geçersiz rol atlandı', session?.messages.length, 2)
  check('içerik onarıldı', session?.messages[0]?.content, '')
  check('üretilen kimlik', session?.messages[0]?.id, 'migrated-0')
  check('onarım sayıldı', report.repaired >= 1, true)
  check('createdAt dolduruldu', typeof session?.messages[0]?.createdAt, 'number')
}

// ============ 5) Retry alanı korunur ============
{
  const withRetry = [
    {
      id: 's4',
      title: 'Retry',
      modelId: 'm',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'x',
          role: 'assistant',
          content: 'kısmi',
          createdAt: 1,
          requestId: 'req-1',
          retry: {
            attempt: 3,
            at: 9999999999999,
            error: { type: 'RateLimit', message: 'Sunucu istek sınırı', status: 429 }
          },
          continuations: 2
        }
      ]
    }
  ]
  const { store } = migrateStore(withRetry)
  const message = store.sessions[0]?.messages[0]
  check('retry korundu', message?.retry?.attempt, 3)
  check('retry hatası korundu', message?.retry?.error.status, 429)
  check('continuations korundu', message?.continuations, 2)
  check('requestId korundu', message?.requestId, 'req-1')
}

// ============ 6) Geçersiz retry temizlenir ============
{
  check('attempt yok → undefined', normalizeRetry({ at: 1, error: {} }), undefined)
  check('attempt 0 → undefined', normalizeRetry({ attempt: 0, at: 1, error: {} }), undefined)
  check('at yok → undefined', normalizeRetry({ attempt: 1, error: {} }), undefined)
  check('nesne değil → undefined', normalizeRetry('x'), undefined)

  const valid = normalizeRetry({
    attempt: 2.4,
    at: 1000.7,
    error: { type: 'Transport', message: 'bağlantı', status: 999 }
  })
  check('attempt yuvarlanır', valid?.attempt, 2)
  check('at yuvarlanır', valid?.at, 1001)
  check('geçersiz status atılır', valid?.error.status, undefined)
  check('tür korunur', valid?.error.type, 'Transport')
}

// ============ 7) Serileştirme ============
{
  const sessions: Session[] = [
    {
      id: 's5',
      title: 't',
      modelId: 'm',
      createdAt: 1,
      updatedAt: 1,
      messages: []
    }
  ]
  const text = serializeStore(sessions)
  const parsed = JSON.parse(text)
  check('sürüm yazıldı', parsed.version, STORE_VERSION)
  check('oturumlar yazıldı', parsed.sessions.length, 1)

  // Tur: göç tekrar uygulanınca değişmemeli (idempotent)
  const again = migrateStore(parsed)
  check('idempotent', JSON.stringify(again.store), JSON.stringify(parsed))
}

// ============ 8) Boş / tanınmayan girdi ============
{
  check('boş dizi', migrateStore([]).store.sessions.length, 0)
  check('null güvenli', migrateStore(null).store.sessions.length, 0)
  check('sayı güvenli', migrateStore(42).store.sessions.length, 0)
  check('bilinmeyen nesne', migrateStore({ foo: 1 }).store.sessions.length, 0)
}

console.log(`TOTAL=32 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
