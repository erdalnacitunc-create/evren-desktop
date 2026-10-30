/// <reference types="node" />
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  __flushWritesForTests,
  __resetCacheForTests,
  appendMessage,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  patchSession,
  renameSession,
  searchSessions,
  setSessionModel,
  setSessionTodos
} from '../src/main/sessionStore'

/**
 * Oturum deposu testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/session-store-test.ts
 *
 * Gerçek dosyaya yazar; her test öncesi önbellek sıfırlanarak kalıcılık
 * (diskten yeniden okuma) da doğrulanır.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const message = (role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) => ({
  id: `m-${Math.random().toString(36).slice(2)}`,
  role,
  content,
  createdAt: Date.now(),
  ...extra
})

app.whenReady().then(async () => {
  await __resetCacheForTests()

  // --- oluşturma ---
  const session = await createSession('model-a')
  check('kimlik üretildi', typeof session.id === 'string' && session.id.length > 10, true)
  check('başlık varsayılan', session.title, 'Yeni sohbet')
  check('mesajlar boş', session.messages, [])

  check('listede görünür', (await listSessions()).length, 1)
  check('kimlikle okunur', (await getSession(session.id))?.modelId, 'model-a')
  check('olmayan oturum null', await getSession('yok'), null)

  // --- mesaj ekleme ve otomatik başlık ---
  await appendMessage(session.id, message('user', '  Merhaba   dünya  '))
  const afterUser = await getSession(session.id)
  check('mesaj eklendi', afterUser?.messages.length, 1)
  check('başlık ilk kullanıcı mesajından', afterUser?.title, 'Merhaba dünya')

  await appendMessage(session.id, message('assistant', 'Yanıt'))
  check('ikinci mesaj', (await getSession(session.id))?.messages.length, 2)
  check('başlık değişmez', (await getSession(session.id))?.title, 'Merhaba dünya')

  check('olmayan oturuma ekleme null', await appendMessage('yok', message('user', 'x')), null)

  // --- kalıcılık: önbellek temizlenip diskten okunur ---
  await __flushWritesForTests()
  await __resetCacheForTests()
  const reloaded = await getSession(session.id)
  check('diskten yeniden okundu', reloaded?.messages.length, 2)
  check('mesaj içeriği olduğu gibi korunur', reloaded?.messages[0]?.content, '  Merhaba   dünya  ')

  const file = join(process.env.EVREN_TEST_DATA as string, 'sessions.json')
  check('dosya oluştu', existsSync(file), true)
  check('dosya geçerli JSON', Array.isArray(JSON.parse(readFileSync(file, 'utf8'))), true)
  check('geçici dosya kalmadı', existsSync(`${file}.tmp`), false)

  // --- yeniden adlandırma ---
  await renameSession(session.id, '  Uzun   başlık  ')
  check('başlık kırpılır', (await getSession(session.id))?.title, 'Uzun başlık')
  await renameSession(session.id, '   ')
  check('boş başlık yok sayılır', (await getSession(session.id))?.title, 'Uzun başlık')
  check('olmayan oturum null (rename)', await renameSession('yok', 'x'), null)

  // --- model ---
  await setSessionModel(session.id, 'model-b')
  check('model güncellenir', (await getSession(session.id))?.modelId, 'model-b')

  // --- todo ---
  await setSessionTodos(session.id, [
    { id: '1', content: 'a', status: 'pending' },
    { id: '2', content: 'b', status: 'completed' }
  ])
  check('todo sayısı', (await getSession(session.id))?.todos?.length, 2)

  const many = Array.from({ length: 150 }, (_, index) => ({
    id: String(index),
    content: `t${index}`,
    status: 'pending' as const
  }))
  await setSessionTodos(session.id, many)
  check('todo en fazla 100', (await getSession(session.id))?.todos?.length, 100)

  // --- patch ---
  await patchSession(session.id, { title: 'Yamalı' } as never)
  check('patch uygulanır', (await getSession(session.id))?.title, 'Yamalı')

  // --- arama ---
  check('başlıkta arar', (await searchSessions('yamalı')).length, 1)
  check('içerikte arar', (await searchSessions('dünya')).length, 1)
  check('modelde arar', (await searchSessions('model-b')).length, 1)
  check('bulunamazsa boş', (await searchSessions('zzz-yok')).length, 0)
  check('boş sorgu tümü', (await searchSessions('   ')).length, 1)

  // --- sıralama ---
  const older = await createSession('model-c')
  await new Promise((resolve) => setTimeout(resolve, 5))
  const newer = await createSession('model-c')
  const listed = await listSessions()
  check('en yeni önce', listed[0]?.id, newer.id)
  check('ikinci sıra', listed.find((item) => item.id === older.id)?.id, older.id)
  check('özet mesaj sayısı', listed.find((item) => item.id === session.id)?.messageCount, 2)

  // --- paralel yazma ---
  const parallel = await createSession('model-p')
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      appendMessage(parallel.id, message('user', `paralel ${index}`))
    )
  )
  await __flushWritesForTests()
  await __resetCacheForTests()
  const parallelReloaded = await getSession(parallel.id)
  check('paralel eklemelerin tümü kalıcı', parallelReloaded?.messages.length, 12)

  // --- silme ---
  check('silme başarılı', await deleteSession(older.id), true)
  check('ikinci silme başarısız', await deleteSession(older.id), false)
  check('listeden çıktı', (await listSessions()).some((item) => item.id === older.id), false)
  await __flushWritesForTests()
  await __resetCacheForTests()
  check('silme kalıcı', (await getSession(older.id)), null)

  console.log(`TOTAL=36 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
