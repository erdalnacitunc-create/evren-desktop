/// <reference types="node" />
import {
  conflictMessage,
  createOwnershipTable,
  findOverlaps,
  isPattern,
  isWriteAllowed,
  normalizePath,
  pathsOverlap,
  writeBlockedMessage
} from '../src/main/agent/fileOwnership'

/**
 * Dosya sahipliği testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/file-ownership-test.ts
 *
 * ## Neden worktree değil
 *
 * `docs/WORKTREE-DECISION.md`: `git worktree add` 493 ms ama yalnızca izlenen
 * dosyaları görür (plc_proje'de 373/16253 = %2,3); `.env`, `secrets.h`,
 * `node_modules`, `.dart_tool` gelmez. Yani sır taraması ve `run_checks`
 * worktree'de çalışmaz. Dosya sahipliği aynı çakışmayı %1 maliyetle çözer.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// ============ 1) Normalizasyon ============
{
  check('ters bölü', normalizePath('src\\a.ts'), 'src/a.ts')
  check('baştaki ./', normalizePath('./src/a.ts'), 'src/a.ts')
  check('çoklu bölü', normalizePath('src//a.ts'), 'src/a.ts')
  check('dizin işareti korunur', normalizePath('src/module/'), 'src/module/')
  check('boş dizin işareti', normalizePath('src/'), 'src/')
}

// ============ 2) Desen tanıma ============
{
  check('düz dosya', isPattern('src/a.ts'), false)
  check('dizin', isPattern('src/'), true)
  check('glob yıldız', isPattern('src/*.ts'), true)
  check('glob çift yıldız', isPattern('src/**/*.ts'), true)
  check('soru işareti', isPattern('src/a?.ts'), true)
}

// ============ 3) Çakışma: aynı dosya ============
{
  check('birebir aynı', pathsOverlap('src/a.ts', 'src/a.ts'), true)
  check('farklı dosya', pathsOverlap('src/a.ts', 'src/b.ts'), false)
  check('farklı dizin', pathsOverlap('src/a/x.ts', 'src/b/x.ts'), false)
}

// ============ 4) Çakışma: dizin prefix ============
{
  check('dizin içindeki dosya', pathsOverlap('src/auth/', 'src/auth/login.ts'), true)
  check('dizin kendisi', pathsOverlap('src/auth/', 'src/auth'), true)
  check('komşu dizin değil', pathsOverlap('src/auth/', 'src/authz/x.ts'), false)
  check('ters yön', pathsOverlap('src/auth/login.ts', 'src/auth/'), true)
  check('iç içe dizin', pathsOverlap('src/', 'src/auth/login.ts'), true)
}

// ============ 5) Çakışma: glob ============
{
  check('glob dosyayı kapsar', pathsOverlap('src/*.ts', 'src/a.ts'), true)
  check('glob alt dizini kapsamaz', pathsOverlap('src/*.ts', 'src/sub/a.ts'), false)
  check('çift glob alt dizini kapsar', pathsOverlap('src/**/*.ts', 'src/sub/a.ts'), true)
  check('glob komşuyu kapsamaz', pathsOverlap('src/*.ts', 'lib/a.ts'), false)
  check('glob desen vs dosya ters', pathsOverlap('src/a.ts', 'src/*.ts'), true)
}

// ============ 6) findOverlaps ============
{
  const hits = findOverlaps(['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts'])
  check('tek çakışma', hits.length, 1)
  check('çakışan yol', hits[0]?.a, 'src/b.ts')
  check('çakışma yok', findOverlaps(['a/'], ['b/']), [])
}

// ============ 7) Tablo: temel talep ============
{
  const table = createOwnershipTable()
  const first = table.claim({ id: 'a1', agentType: 'general', paths: ['src/auth/'] })
  check('ilk talep başarılı', first.ok, true)
  check('kayıt görünür', table.snapshot().length, 1)
  check('yollar okunur', table.pathsOf('a1'), ['src/auth/'])
}

// ============ 8) Tablo: çakışma reddi (canlı kusur) ============
{
  const table = createOwnershipTable()
  table.claim({ id: 'a1', agentType: 'general', paths: ['src/auth/'] })

  const second = table.claim({
    id: 'a2',
    agentType: 'general',
    paths: ['src/auth/login.ts']
  })
  check('çakışan talep reddedildi', second.ok, false)
  if (!second.ok) {
    check('çakışma raporlandı', second.conflicts.length >= 1, true)
    check('sahip kimliği', second.conflicts[0]?.ownerId, 'a1')
    check('sahip türü', second.conflicts[0]?.ownerType, 'general')
  }
  check('red sonrası tablo değişmedi', table.snapshot().length, 1)
  check('reddedilen ajan kayıtlı değil', table.pathsOf('a2'), [])
}

// ============ 9) Tablo: ayrık yollar kabul ============
{
  const table = createOwnershipTable()
  check(
    'birinci',
    table.claim({ id: 'a1', agentType: 'general', paths: ['src/auth/'] }).ok,
    true
  )
  check(
    'ikinci ayrık',
    table.claim({ id: 'a2', agentType: 'general', paths: ['src/billing/'] }).ok,
    true
  )
  check('iki sahiplik', table.snapshot().length, 2)
}

// ============ 10) Tablo: bırakma ============
{
  const table = createOwnershipTable()
  table.claim({ id: 'a1', agentType: 'general', paths: ['src/auth/'] })
  table.release('a1')
  check('bırakıldı', table.snapshot().length, 0)
  check(
    'sonra başkası alabilir',
    table.claim({ id: 'a2', agentType: 'general', paths: ['src/auth/login.ts'] }).ok,
    true
  )
}

// ============ 11) Tablo: atomiklik ============
{
  const table = createOwnershipTable()
  table.claim({ id: 'a1', agentType: 'general', paths: ['src/auth/'] })

  // Bir yol çakışıyor, biri boş → hiçbiri yazılmamalı.
  const result = table.claim({
    id: 'a2',
    agentType: 'general',
    paths: ['src/billing/', 'src/auth/x.ts']
  })
  check('kısmi talep reddedildi', result.ok, false)
  check('boş yol da yazılmadı', table.pathsOf('a2'), [])
}

// ============ 12) Tablo: boş talep ============
{
  const table = createOwnershipTable()
  check('boş liste kabul', table.claim({ id: 'a1', agentType: 'general', paths: [] }).ok, true)
  check('boş kayıt yok', table.snapshot().length, 0)
}

// ============ 13) Yazma izni ============
{
  check('kısıt yok → izin', isWriteAllowed('src/a.ts', undefined), true)
  check('boş liste → izin', isWriteAllowed('src/a.ts', []), true)
  check('listede → izin', isWriteAllowed('src/auth/login.ts', ['src/auth/']), true)
  check('liste dışı → ret', isWriteAllowed('src/billing/x.ts', ['src/auth/']), false)
  check('glob eşleşir', isWriteAllowed('src/a.ts', ['src/*.ts']), true)
  check('glob eşleşmez', isWriteAllowed('src/sub/a.ts', ['src/*.ts']), false)
}

// ============ 14) Mesajlar ============
{
  const conflict = conflictMessage([
    { path: 'src/auth/login.ts', ownerId: 'sub-1234567890ab', ownerType: 'general', ownerPaths: ['src/auth/'] }
  ])
  check('çakışma mesajı başlık', conflict.includes('Dosya sahipliği çakışması'), true)
  check('yol görünür', conflict.includes('src/auth/login.ts'), true)
  check('sahip görünür', conflict.includes('general'), true)
  check('çözüm öneriyor', /daralt|bekle|kendin/.test(conflict), true)

  const blocked = writeBlockedMessage('src/x.ts', ['src/auth/'])
  check('engel mesajı yolu gösterir', blocked.includes('src/x.ts'), true)
  check('izin listesini gösterir', blocked.includes('src/auth/'), true)
  check('genişletme yasak', /genişletme/.test(blocked), true)
}

// ============ 15) Gerçek senaryo: 3 ajan, ayrık modüller ============
{
  const table = createOwnershipTable()
  const agents = [
    { id: 'auth', paths: ['src/auth/', 'src/lib/token.ts'] },
    { id: 'billing', paths: ['src/billing/'] },
    { id: 'tests', paths: ['tests/auth.test.ts', 'tests/billing.test.ts'] }
  ]
  for (const agent of agents) {
    check(`${agent.id} kabul`, table.claim({ ...agent, agentType: 'general' }).ok, true)
  }
  check('üç sahiplik', table.snapshot().length, 3)

  // Dördüncü ajan ortak dosya istiyor → reddedilmeli.
  const conflict = table.claim({
    id: 'shared',
    agentType: 'general',
    paths: ['src/lib/token.ts']
  })
  check('ortak dosya reddedildi', conflict.ok, false)
}

// ============ 16) Deterministik ============
{
  const a = pathsOverlap('src/**/*.ts', 'src/a/b/c.ts')
  const b = pathsOverlap('src/**/*.ts', 'src/a/b/c.ts')
  check('aynı girdi aynı çıktı', a, b)
}

console.log(`TOTAL=52 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
