/// <reference types="node" />
import {
  PROGRESS_NUDGE,
  PROGRESS_NUDGE_FINAL,
  isCoordinationProgress,
  isProductiveRead,
  progressNudgeMessage,
  shouldNudgeProgress,
  stalledStreak,
  type StepObservation
} from '../src/main/agent/progressGuard'

/**
 * İlerlemesiz döngü koruması testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/progress-guard-test.ts
 *
 * Canlı koşudan gelen senaryo: 19 dakika, 30 araç, uzun süre hiç metin yok —
 * model scan_usb.ps1 … scan_usb6.ps1 yazıp çalıştırdı.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const silent = (tools: string[] = ['run_command']): StepObservation => ({
  contentLength: 0,
  tools
})
const talkative = (tools: string[] = ['run_command']): StepObservation => ({
  contentLength: 42,
  tools
})
const noTools: StepObservation = { contentLength: 0, tools: [] }

// ============ 1) Canlı koşu senaryosu ============
{
  const observed: StepObservation[] = [
    silent(['write_file']),
    silent(['run_command']),
    silent(['write_file']),
    silent(['run_command'])
  ]
  check('4 metinsiz adım → yönlendir', shouldNudgeProgress(observed), true)
  check('ardışık seri 4', stalledStreak(observed), 4)
}

// ============ 2) Eşik altında tetiklenmez ============
{
  check('3 adım → tetiklenmez', shouldNudgeProgress([silent(), silent(), silent()]), false)
  check('2 adım → tetiklenmez', shouldNudgeProgress([silent(), silent()]), false)
  check('boş geçmiş', shouldNudgeProgress([]), false)
}

// ============ 3) Metin varsa tetiklenmez ============
{
  const withText = [silent(), silent(), silent(), talkative()]
  check('son adımda metin var → hayır', shouldNudgeProgress(withText), false)
  const middle = [silent(), talkative(), silent(), silent()]
  check('ortada metin var → hayır', shouldNudgeProgress(middle), false)
  check('tek metin seriyi böler', stalledStreak([silent(), talkative(), silent()]), 1)
}

// ============ 4) Araçsız adım ilerleme sayılır ============
{
  check('araçsız adım seriyi böler', shouldNudgeProgress([silent(), silent(), silent(), noTools]), false)
  check('seri araçsızda durur', stalledStreak([silent(), noTools, silent()]), 1)
}

// ============ 5) Yönlendirme sayısı sınırlı ============
{
  const long = Array.from({ length: 12 }, () => silent())
  check('ilk yönlendirme', shouldNudgeProgress(long, 0), true)
  check('ikinci yönlendirme', shouldNudgeProgress(long, 1), true)
  check('üçüncü yönlendirme yok', shouldNudgeProgress(long, 2), false)
  check('maxNudges=1', shouldNudgeProgress(long, 1, { maxNudges: 1 }), false)
  check('maxNudges=0', shouldNudgeProgress(long, 0, { maxNudges: 0 }), false)
}

// ============ 6) Eşik yapılandırılabilir ============
{
  check('eşik 2', shouldNudgeProgress([silent(), silent()], 0, { threshold: 2 }), true)
  check('eşik 6', shouldNudgeProgress(Array.from({ length: 5 }, () => silent()), 0, { threshold: 6 }), false)
  check(
    'eşik 6 tam',
    shouldNudgeProgress(Array.from({ length: 6 }, () => silent()), 0, { threshold: 6 }),
    true
  )
  check('eşik en az 2', shouldNudgeProgress([silent(), silent()], 0, { threshold: 1 }), true)
}

// ============ 7) Yalnızca son pencereye bakılır ============
{
  // Başta metin vardı ama son 4 adım sessiz → yönlendir.
  const mixed = [talkative(), talkative(), silent(), silent(), silent(), silent()]
  check('pencere son 4 adım', shouldNudgeProgress(mixed), true)

  // Metinli adım pencerenin hemen dışında kalırsa seri kısalır.
  const tail = [silent(), silent(), silent(), silent(), talkative(), silent(), silent()]
  check('son 4 adımda metin var', shouldNudgeProgress(tail), false)
}

// ============ 8) Mesaj seçimi ============
{
  check('ilk mesaj yumuşak', progressNudgeMessage(0), PROGRESS_NUDGE)
  check('ikinci mesaj kesin', progressNudgeMessage(1), PROGRESS_NUDGE_FINAL)
  check('üçüncü de kesin', progressNudgeMessage(5), PROGRESS_NUDGE_FINAL)
  check('yumuşak mesaj rapor istiyor', /raporla/i.test(PROGRESS_NUDGE), true)
  check('kesin mesaj araç çağrısını yasaklıyor', /bırak/i.test(PROGRESS_NUDGE_FINAL), true)
}

// ============ 9) Deterministik ve girdi değişmiyor ============
{
  const input = [silent(), silent(), silent(), silent()]
  const snapshot = JSON.stringify(input)
  const first = shouldNudgeProgress(input)
  const second = shouldNudgeProgress(input)
  check('aynı girdi aynı çıktı', first, second)
  check('girdi değişmedi', JSON.stringify(input), snapshot)
}

// ============ 10) Çok araçlı adım da ilerlemesiz ============
{
  const many = Array.from({ length: 4 }, () => silent(['write_file', 'run_command', 'read_file']))
  check('çok araçlı sessiz adımlar', shouldNudgeProgress(many), true)
}

// ============ 11) Okuma yapan sessiz adımlar ilerlemedir (0.4.17) ============
// Canlı kusur: gemma-4-31b dört adımda dosya okudu, hiç metin yazmadı;
// yönlendirme "araç çağırmayı bırak, raporla" dedi ve inceleme yarıda kesildi
// (1886 kr rapor, sıfır alt ajan — oysa istem alt ajan istiyordu).
{
  const readStep = (reads: number): StepObservation => ({
    contentLength: 0,
    tools: ['run_command'],
    productiveReads: reads
  })

  check('okumalı adımlar yönlendirme tetiklemez', shouldNudgeProgress([readStep(1), readStep(2), readStep(1), readStep(3)]), false)
  check('okumasız adımlar hâlâ tetikler', shouldNudgeProgress([readStep(0), readStep(0), readStep(0), readStep(0)]), true)
  check(
    'karışık: son adım okumasız ise pencere bozulur',
    shouldNudgeProgress([readStep(1), readStep(1), readStep(1), readStep(0)]),
    false
  )
  check('stalledStreak okumada durur', stalledStreak([readStep(0), readStep(2), readStep(0)]), 1)
}

// ============ 12) Sert eşik: ilerleme kesilince devreye girer ============
{
  const readStep = (reads: number): StepObservation => ({
    contentLength: 0,
    tools: ['run_command'],
    productiveReads: reads
  })
  // Taze ilerleme sürdüğü sürece yönlendirme yok (uzun keşif meşru).
  const active = Array.from({ length: 12 }, () => readStep(1))
  check('12 adım sürekli okuma → yönlendirme yok', shouldNudgeProgress(active), false)

  // Son 6 adımda ilerleme bittiyse sert eşik devreye girer.
  const dried = [...Array.from({ length: 6 }, () => readStep(1)), ...Array.from({ length: 6 }, () => readStep(0))]
  check('ilerleme kurudu → sert eşik', shouldNudgeProgress(dried), true)

  check(
    'sert eşik yapılandırılabilir',
    shouldNudgeProgress(
      [...Array.from({ length: 2 }, () => readStep(1)), ...Array.from({ length: 3 }, () => readStep(0))],
      0,
      { hardThreshold: 5, freshProgressWindow: 3 }
    ),
    true
  )
}

// ============ 13) Okuma tanımı ============
{
  check('run_command + içerik = okuma', isProductiveRead('run_command', true, 500), true)
  check('execute + içerik = okuma', isProductiveRead('execute', true, 500), true)
  check('read_file + içerik = okuma', isProductiveRead('read_file', true, 500), true)
  check('başarısız araç okuma değil', isProductiveRead('read_file', false, 5000), false)
  check('boş çıktı okuma değil', isProductiveRead('run_command', true, 10), false)
  check('yazma aracı okuma değil', isProductiveRead('write_file', true, 500), false)
  check('todo_write okuma değil', isProductiveRead('todo_write', true, 500), false)
}

// ============ 14) Koordinasyon ilerlemedir (0.4.18) ============
// Canlı kusur: faz 1'de ana ajanın dört adımı
//   spawn_agent → spawn_agent → task_wait → task_wait
// idi. Okuma yoktu, metin yoktu — ama gerçek iş yönetimi vardı (arka planda
// ajan çalışıyor, ana ajan bekliyor). Yönlendirme yine "araç çağırmayı bırak"
// dedi; yanlış zamanlama.
{
  const coord = (signals: number): StepObservation => ({
    contentLength: 0,
    tools: ['task_wait'],
    productiveReads: 0,
    coordinationSignals: signals
  })

  check(
    'koordinasyonlu adımlar yönlendirme tetiklemez',
    shouldNudgeProgress([coord(1), coord(1), coord(1), coord(1)]),
    false
  )
  check(
    'koordinasyonsuz adımlar tetikler',
    shouldNudgeProgress([coord(0), coord(0), coord(0), coord(0)]),
    true
  )
  check(
    'okuma + koordinasyon karışık',
    shouldNudgeProgress([
      { contentLength: 0, tools: ['spawn_agent'], productiveReads: 0, coordinationSignals: 1 },
      { contentLength: 0, tools: ['read_file'], productiveReads: 2, coordinationSignals: 0 },
      { contentLength: 0, tools: ['task_wait'], productiveReads: 0, coordinationSignals: 1 },
      { contentLength: 0, tools: ['grep'], productiveReads: 1, coordinationSignals: 0 }
    ]),
    false
  )
  check('stalledStreak koordinasyonda durur', stalledStreak([coord(0), coord(1), coord(0)]), 1)

  // Güvenlik ağı: 12 metinsiz koordinasyon adımı hâlâ yönlendirmez; taze
  // ilerleme sürüyorsa uzun keşif meşrudur (bkz. §16).
}

// ============ 15) Koordinasyon aracı tanımı ============
{
  check('spawn_agent başarılı = koordinasyon', isCoordinationProgress('spawn_agent', true, 200), true)
  check('task_wait "hâlâ çalışıyor" = koordinasyon', isCoordinationProgress('task_wait', true, 272), true)
  check('task_status = koordinasyon', isCoordinationProgress('task_status', true, 120), true)
  check('task_wait kısa hata = değil', isCoordinationProgress('task_wait', true, 20), false)
  check('spawn başarısız = değil', isCoordinationProgress('spawn_agent', false, 500), false)
  check('read_file koordinasyon değil', isCoordinationProgress('read_file', true, 500), false)
}

// ============ 16) Koordinasyonla süren sessiz adımlar yönlendirme üretmez ============
// 0.4.18 canlı koşusu (faz 2): ana ajan 8 adım boyunca alt ajan başlatıp
// bekledi; her adımda gerçek koordinasyon vardı. Sert eşik yalnızca ham adım
// sayısına baktığı için "metinsiz" sayıp yönlendirme gönderdi.
{
  const coord = (signals: number): StepObservation => ({
    contentLength: 0,
    tools: ['spawn_agent'],
    productiveReads: 0,
    coordinationSignals: signals
  })

  const eightCoord = Array.from({ length: 8 }, () => coord(1))
  check('8 koordinasyonlu adım yönlendirmez', shouldNudgeProgress(eightCoord), false)

  const twelveCoord = Array.from({ length: 12 }, () => coord(1))
  check('12 koordinasyonlu adım hâlâ yönlendirmez', shouldNudgeProgress(twelveCoord), false)

  // İlerleme kesilirse (son 6 adımda okuma/koordinasyon yok) sert eşik devreye girer.
  const stalled = [
    ...Array.from({ length: 6 }, () => coord(1)),
    ...Array.from({ length: 6 }, () => ({
      contentLength: 0,
      tools: ['run_command'],
      productiveReads: 0,
      coordinationSignals: 0
    }))
  ]
  check('12 adım, son 6’sı ilerlemesiz → yönlendirir', shouldNudgeProgress(stalled), true)

  // Sert eşik yapılandırılabilir (taze pencere ile).
  const mixed = [
    ...Array.from({ length: 5 }, () => coord(1)),
    ...Array.from({ length: 5 }, () => ({
      contentLength: 0,
      tools: ['run_command'],
      productiveReads: 0,
      coordinationSignals: 0
    }))
  ]
  check(
    'taze pencere 10 → ilerleme eski sayılır',
    shouldNudgeProgress(mixed, 0, { hardThreshold: 10, freshProgressWindow: 5 }),
    true
  )
}

console.log(`TOTAL=63 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
