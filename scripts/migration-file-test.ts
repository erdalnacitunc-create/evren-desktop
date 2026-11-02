/// <reference types="node" />
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  __flushWritesForTests,
  __resetCacheForTests,
  appendMessage,
  getSession,
  listSessions
} from '../src/main/sessionStore'
import { STORE_VERSION } from '../src/main/sessionMigration'

/**
 * Gerçek dosyayla göç testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/migration-file-test.ts
 *
 * Eski sürümün yazdığı düz dizi biçimini diske koyup uygulamanın onu
 * bozmadan yüklediğini ve yeni biçimde geri yazdığını doğrular.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

/** v0.4.0 öncesi biçim: düz dizi. */
const LEGACY = [
  {
    id: 'legacy-1',
    title: 'Eski sohbet',
    modelId: 'deepseek-v4.1-flash',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    messages: [
      {
        id: 'u1',
        role: 'user',
        content: 'usb tara',
        createdAt: 1700000000500
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'USB taraması bitti.',
        reasoning: 'düşünme metni',
        createdAt: 1700000000900,
        finishReason: 'stop',
        requestId: 'req-legacy'
      }
    ],
    workspacePath: 'C:\\Temp\\ws',
    todos: [{ id: 't1', content: 'görev', status: 'pending' }]
  },
  {
    id: 'legacy-broken',
    title: 'Bozuk',
    modelId: 'm',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ role: 'geçersiz' }, { id: 'x', role: 'user', content: 'sağlam', createdAt: 2 }]
  }
]

app.whenReady().then(async () => {
  const file = join(dataDir, 'sessions.json')
  writeFileSync(file, JSON.stringify(LEGACY), 'utf8')
  await __resetCacheForTests()

  // ===== 1) yükleme göçten geçti =====
  const list = await listSessions()
  check('iki oturum yüklendi', list.length, 2)
  const first = await getSession('legacy-1')
  check('başlık korundu', first?.title, 'Eski sohbet')
  check('model korundu', first?.modelId, 'deepseek-v4.1-flash')
  check('mesaj sayısı', first?.messages.length, 2)
  check('içerik korundu', first?.messages[0]?.content, 'usb tara')
  check('reasoning korundu', first?.messages[1]?.reasoning, 'düşünme metni')
  check('finishReason korundu', first?.messages[1]?.finishReason, 'stop')
  check('requestId korundu', first?.messages[1]?.requestId, 'req-legacy')
  check('workspacePath korundu', first?.workspacePath, 'C:\\Temp\\ws')
  check('todos korundu', first?.todos?.length, 1)

  // ===== 2) bozuk kayıt kurtarıldı =====
  const broken = await getSession('legacy-broken')
  check('bozuk oturum kaldı', !!broken, true)
  check('geçersiz mesaj atlandı', broken?.messages.length, 1)
  check('sağlam mesaj korundu', broken?.messages[0]?.content, 'sağlam')

  // ===== 3) dosya yeni biçimde geri yazıldı =====
  await __flushWritesForTests()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  check('diskte sürüm alanı', onDisk.version, STORE_VERSION)
  check('diskte sessions dizisi', Array.isArray(onDisk.sessions), true)
  check('diskte iki oturum', onDisk.sessions.length, 2)

  // ===== 4) yeni kayıt eklenebiliyor =====
  await appendMessage('legacy-1', {
    id: 'new-1',
    role: 'user',
    content: 'yeni mesaj',
    createdAt: Date.now()
  })
  await __flushWritesForTests()
  check('yeni mesaj eklendi', (await getSession('legacy-1'))?.messages.length, 3)

  // ===== 5) ikinci açılış idempotent =====
  await __resetCacheForTests()
  const reloaded = await getSession('legacy-1')
  check('yeniden yükleme bozmadı', reloaded?.messages.length, 3)
  check('dosya hâlâ geçerli', existsSync(file), true)

  console.log(`TOTAL=19 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
