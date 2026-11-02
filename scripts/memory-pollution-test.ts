/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import {
  __resetMemoryCacheForTests,
  addMemory,
  listMemories
} from '../src/main/memory/store'
import { buildMemoryContext } from '../src/main/memory/retrieve'
import { VOLATILE_MEMORY_CAVEAT } from '../src/main/memory/memoryGuard'

/**
 * Hafıza kirliliği düzeltmesinin uçtan uca testi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/memory-pollution-test.ts
 *
 * İddia:
 *  - Geçici gözlemler (USB envanteri, port listesi, IP…) `volatile` işaretlenir.
 *  - Kalıcı anılar işaretlenmez.
 *  - Geri getirmede geçici anıya "GEÇMİŞ GÖZLEM — doğrula" uyarısı eklenir.
 *  - Uyarı yoksa (yalnızca kalıcı anılar) ek uyarı paragrafı çıkmaz.
 */

const dataDir = join(process.env.EVREN_TEST_DATA as string, 'mem-pollution')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// embedText ağ çağrısı yapar; başarısız olursa anahtar kelime puanı kullanılır.
const NO_SERVER = 'http://127.0.0.1:9'

app.whenReady().then(async () => {
  await __resetMemoryCacheForTests()

  // ===== 1) Kaydetme: geçici anılar işaretlenir =====
  const asix = await addMemory({
    type: 'reference',
    text:
      'Bağlı USB aygıtları arasında ASIX Electronics Corp Gigabit Ethernet adaptörü (VID_0B05&PID_6206) bulunmaktadır.',
    tags: ['donanım', 'usb']
  })
  check('ASIX anısı geçici', asix.volatile, true)
  check('geçicilik nedeni', asix.volatileKind, 'usb-inventory')

  const ports = await addMemory({
    type: 'reference',
    text: 'Sistemde COM5, COM7 ve COM9 portlarında üç CP210x köprüsü var.'
  })
  check('port listesi geçici', ports.volatile, true)

  const durable = await addMemory({
    type: 'project',
    text: 'Bağlı cihaz incelenirken salt-okunur yaklaşım benimsendi; ayar değiştiren komutlar kullanılmayacak.',
    tags: ['android', 'read-only']
  })
  check('kalıcı anı işaretsiz', durable.volatile, false)
  check('kalıcı anıda neden yok', durable.volatileKind, undefined)

  const pref = await addMemory({
    type: 'user',
    text: 'Kullanıcı yanıtları Türkçe istiyor.'
  })
  check('tercih işaretsiz', pref.volatile, false)

  // ===== 2) Listeleme işaretleri koruyor =====
  const all = await listMemories()
  check('dört anı', all.length, 4)
  check('iki geçici', all.filter((entry) => entry.volatile).length, 2)
  check('iki kalıcı', all.filter((entry) => !entry.volatile).length, 2)

  // ===== 3) Geri getirme: uyarı eklenir =====
  const context = await buildMemoryContext(NO_SERVER, 'test', [
    { role: 'user', content: 'USB aygıtlarını tara ve ASIX adaptörünü incele' }
  ])
  check('bağlam üretildi', context !== null, true)
  check('uyarı metni var', (context ?? '').includes(VOLATILE_MEMORY_CAVEAT), true)
  check(
    'doğrulama talimatı var',
    /araçla .*doğrula|doğrula ve çelişki/i.test(context ?? '') ||
      (context ?? '').includes('usb_devices'),
    true
  )
  check('ASIX anısı bağlamda', (context ?? '').includes('ASIX'), true)

  console.log('\n--- üretilen bağlam ---')
  console.log(context)

  // ===== 4) Yalnızca kalıcı anı varsa uyarı yok =====
  const tmp = join(process.env.EVREN_TEST_DATA as string, 'mem-durable-only')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  app.setPath('userData', tmp)
  await __resetMemoryCacheForTests()

  await addMemory({ type: 'user', text: 'Kullanıcı commit mesajlarında Türkçe tercih ediyor.' })
  const cleanContext = await buildMemoryContext(NO_SERVER, 'test', [
    { role: 'user', content: 'commit mesajı yaz' }
  ])
  check('temiz bağlam üretildi', cleanContext !== null, true)
  check('gereksiz uyarı yok', (cleanContext ?? '').includes(VOLATILE_MEMORY_CAVEAT), false)

  console.log(`TOTAL=15 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
