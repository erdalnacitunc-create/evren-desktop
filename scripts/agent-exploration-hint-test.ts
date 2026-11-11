/// <reference types="node" />
import {
  EXPLORATION_HINT,
  countPaths,
  emptyExplorationState,
  explorationHintMessage,
  shouldHintExploration,
  updateExploration,
  type ExplorationState,
  type ToolObservation
} from '../src/main/agent/explorationHint'

/**
 * Keşif ipucu testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-exploration-hint-test.ts
 *
 * Canlı koşuda gözlendi: model 40+ dosyayı listeledi, hiçbirini okumadı,
 * raporunda "içeriği okunmadı — doğrulanamadı" yazdı ve alt ajan hiç
 * aklına gelmedi. Bu modül o durumu tespit eder.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const obs = (toolName: string, content: string, ok = true): ToolObservation => ({
  toolName,
  ok,
  content
});
// ============ 1) Yol sayımı ============
{
  check('tek dosya adı', countPaths('main.cpp'), 1)
  check('uzantılı isimler', countPaths('a.h b.cpp c.dart'), 3)
  check(
    'Windows yolu',
    countPaths('C:\\Users\\erdal\\Desktop\\src\\main.cpp'),
    1
  )
  check('tekrar sayılmaz', countPaths('main.cpp main.cpp MAIN.CPP'), 1)
  check('boş metin', countPaths(''), 0)
  check(
    'gerçekçi listeleme',
    countPaths('src/main.cpp\nsrc/api.h\nsrc/web.h\nlib/util.cpp\nlib/util.h'),
    5
  )
}

// ============ 2) İçerik okuyan araçlar ============
{
  let state = emptyExplorationState()
  state = updateExploration(state, obs('read_file', 'içerik burada'))
  check('read_file okuma sayar', state.readFiles, 1)
  check('read_file okuma çağrısı', state.readCalls, 1)
  check('read_file listeleme saymaz', state.listCalls, 0)

  let search = emptyExplorationState()
  search = updateExploration(search, obs('code_search', 'a.ts\nb.ts\nc.ts'))
  check('code_search yolları sayar', search.readFiles, 3)
}

// ============ 3) Listeleyen araçlar ============
{
  let state = emptyExplorationState()
  state = updateExploration(state, obs('list_files', 'a.ts\nb.ts'))
  check('list_files listeleme sayar', state.listedFiles, 2)
  check('list_files okuma saymaz', state.readFiles, 0)
  check('list_files çağrı sayısı', state.listCalls, 1)

  let glob = emptyExplorationState()
  glob = updateExploration(glob, obs('glob', 'x/y.rs\nx/z.rs\nx/w.rs'))
  check('glob 3 dosya', glob.listedFiles, 3)
}

// ============ 4) run_command: listeleme mi okuma mı ============
{
  // Canlı koşudaki gerçek çıktı biçimi.
  const listOutput = [
    'C:\\Users\\erdal\\Desktop\\wifi klima\\src\\main.cpp',
    'C:\\Users\\erdal\\Desktop\\wifi klima\\src\\mqtt.h',
    'C:\\Users\\erdal\\Desktop\\wifi klima\\src\\api.h',
    'C:\\Users\\erdal\\Desktop\\wifi klima\\src\\kumanda.h',
    'C:\\Users\\erdal\\Desktop\\wifi klima\\src\\web.h',
    'C:\\Users\\erdal\\Desktop\\wifi klima\\src\\durum_coz.h'
  ].join('\n')

  let list = emptyExplorationState()
  list = updateExploration(list, obs('run_command', listOutput))
  check('listeleme komutu listeleme sayılır', list.listCalls, 1)
  check('6 dosya sayıldı', list.listedFiles >= 5, true)
  check('okuma sayılmadı', list.readFiles, 0)

  let read = emptyExplorationState()
  read = updateExploration(read, obs('run_command', "Get-Content src/main.cpp\nint main(){}"))
  check('Get-Content okuma sayılır', read.readCalls, 1)
  check('Get-Content listeleme saymaz', read.listCalls, 0)
}

// ============ 5) Başarısız araç yok sayılır ============
{
  let state = emptyExplorationState()
  state = updateExploration(state, obs('list_files', 'a.ts\nb.ts', false))
  check('başarısız sonuç sayılmaz', state.listedFiles, 0)
}

// ============ 6) İpucu: tetiklenmeli ============
{
  // 40 dosya listelendi, hiçbiri okunmadı → canlı koşunun birebir durumu.
  const state: ExplorationState = {
    listedFiles: 40,
    readFiles: 0,
    listCalls: 4,
    readCalls: 0
  }
  check('40 listelendi 0 okundu → ipucu', shouldHintExploration(state), true)
}

// ============ 7) İpucu: tetiklenmemeli ============
{
  check('az dosya', shouldHintExploration({ listedFiles: 5, readFiles: 0, listCalls: 1, readCalls: 0 }), false)
  check('hiç listeleme', shouldHintExploration(emptyExplorationState()), false)
  check(
    'yeterince okunmuş',
    shouldHintExploration({ listedFiles: 10, readFiles: 4, listCalls: 1, readCalls: 4 }),
    false
  )
  check(
    'ipucu zaten verilmiş',
    shouldHintExploration({ listedFiles: 40, readFiles: 0, listCalls: 4, readCalls: 0 }, 1),
    false
  )
  check(
    'ipucu hakkı tükendi',
    shouldHintExploration({ listedFiles: 40, readFiles: 0, listCalls: 4, readCalls: 0 }, 2, 2),
    false
  )
}

// ============ 8) Oran eşiği ============
{
  // 40 listelendi 8 okundu = %20 → sınırda, ipucu yok (oran < 0.2 değil).
  check(
    'tam %20 ipucu vermez',
    shouldHintExploration({ listedFiles: 40, readFiles: 8, listCalls: 4, readCalls: 8 }),
    false
  )
  // 40 listelendi 7 okundu = %17.5 → ipucu var.
  check(
    '%17 ipucu verir',
    shouldHintExploration({ listedFiles: 40, readFiles: 7, listCalls: 4, readCalls: 7 }),
    true
  )
  check(
    'eşik yapılandırılabilir',
    shouldHintExploration(
      { listedFiles: 10, readFiles: 3, listCalls: 1, readCalls: 3 },
      0,
      1,
      { maxReadRatio: 0.5 }
    ),
    true
  )
  check(
    'min dosya yapılandırılabilir',
    shouldHintExploration({ listedFiles: 6, readFiles: 0, listCalls: 1, readCalls: 0 }, 0, 1, {
      minListedFiles: 5
    }),
    true
  )
}

// ============ 9) maxHints ============
{
  const state = { listedFiles: 50, readFiles: 0, listCalls: 5, readCalls: 0 }
  check('ilk ipucu', shouldHintExploration(state, 0, 2), true)
  check('ikinci ipucu', shouldHintExploration(state, 1, 2), true)
  check('üçüncü ipucu yok', shouldHintExploration(state, 2, 2), false)
  check('maxHints=0', shouldHintExploration(state, 0, 0), false)
}

// ============ 10) İpucu metni ============
{
  const hint = explorationHintMessage()
  check('aynı metin', hint, EXPLORATION_HINT)
  check('alt ajan öneriyor', /spawn_agent/.test(hint), true)
  check('paralel diyor', /paralel/i.test(hint), true)
  check('explore diyor', /explore/.test(hint), true)
  check('yapı sorusunda yok say diyor', /yok say/i.test(hint), true)
  check('içerik vurgusu', /içerik/i.test(hint), true)
}

// ============ 11) Gerçekçi akış ============
{
  let state = emptyExplorationState()
  const listOutput = Array.from(
    { length: 12 },
    (_, index) => `C:\\proje\\src\\modul${index}.cpp`
  ).join('\n')

  // Model 3 kez listeliyor (farklı klasörler).
  state = updateExploration(state, obs('run_command', listOutput))
  state = updateExploration(state, obs('run_command', listOutput.replace(/modul/g, 'lib')))
  state = updateExploration(state, obs('run_command', listOutput.replace(/modul/g, 'drv')))
  check('3 listeleme', state.listCalls, 3)
  check('36 dosya', state.listedFiles, 36)
  check('0 okuma', state.readFiles, 0)
  check('ipucu verilir', shouldHintExploration(state), true)

  // Model ipucundan sonra 2 alt ajan başlatıp sonuçları okusa bile durum
  // yalnızca okuma araçlarıyla güncellenir (spawn sayılmaz).
  state = updateExploration(state, obs('read_file', 'içerik'))
  check('okuma sonrası oran düşük kalır', shouldHintExploration(state, 1), false)
}

// ============ 12) Deterministik ve girdi değişmiyor ============
{
  const state = emptyExplorationState()
  const input = obs('list_files', 'a.ts\nb.ts')
  const before = JSON.stringify(input)
  const first = updateExploration(state, input)
  const second = updateExploration(state, input)
  check('aynı girdi aynı çıktı', JSON.stringify(first), JSON.stringify(second))
  check('girdi değişmedi', JSON.stringify(input), before)
  check('orijinal durum değişmedi', state.listedFiles, 0)
}

console.log(`TOTAL=48 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
