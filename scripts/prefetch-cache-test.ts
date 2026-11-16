/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  MAX_PREFETCH,
  appendPrefetch,
  extractCandidates,
  prefetchFiles,
  prefetchNote,
  resolveInside
} from '../src/main/agent/prefetch'
import {
  CACHE_PRESERVE_TRIM_THRESHOLD,
  contextSize,
  promptFingerprint,
  shouldTrimStale,
  wantsAnthropicCache,
  withAnthropicCache
} from '../src/main/agent/promptCache'

/**
 * Önbellek + ön okuma testleri (saf mantık, ağ yok).
 * Çalıştırma: node scripts/run-unit.cjs scripts/prefetch-cache-test.ts
 *
 * ## Neden
 *
 * 0.4.20 ölçümü: adım başına 88 sn, araç payı <%2. Yani kazanç ancak
 * **adım sayısını azaltmak** (ön okuma) veya **girişi önbelleğe aldırmak**
 * (sabit önek) ile gelir.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

app.whenReady().then(async () => {
  const root = join(dataDir, 'prefetch')
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'README.md'), '# proje\n', 'utf8')
  writeFileSync(join(src, 'main.cpp'), 'int main() { return 0; }\n', 'utf8')
  writeFileSync(join(src, 'mqtt.h'), '#pragma once\n', 'utf8')
  writeFileSync(join(root, 'buyuk.txt'), 'x'.repeat(50_000), 'utf8')

  // ============ 1) Aday çıkarma ============
  {
    const prompt =
      'src/main.cpp ve src/mqtt.h dosyalarını oku. Ayrıca `README.md` dosyasına bak. ' +
      'Şu dosyalar önemli değil: node_modules/x.js ve build/out. Not: 3.14 sayısı.'
    const candidates = extractCandidates(prompt, [])
    check('cpp bulundu', candidates.includes('src/main.cpp'), true)
    check('h bulundu', candidates.includes('src/mqtt.h'), true)
    check('md bulundu', candidates.includes('README.md'), true)
    check('sayı dosya sanılmadı', candidates.includes('3.14'), false)
    check('tekrarsız', candidates.length, new Set(candidates).size)

    const withOwned = extractCandidates('incele', ['src/main.cpp', 'src/', 'src/*.ts'])
    check('sahiplik düz dosya alındı', withOwned.includes('src/main.cpp'), true)
    check('sahiplik dizini atlandı', withOwned.includes('src/'), false)
    check('glob atlandı', withOwned.includes('src/*.ts'), false)
  }

  // ============ 2) Kapsam koruması ============
  {
    check('içeride', resolveInside(root, 'src/main.cpp')?.toLowerCase().startsWith(root.toLowerCase()), true)
    check('dışarı çıkmaz', resolveInside(root, '../../../etc/passwd'), null)
    check('mutlak dış yol', resolveInside(root, 'C:\\Windows\\win.ini'), null)
  }

  // ============ 3) Ön okuma ============
  {
    const files = await prefetchFiles({
      root,
      candidates: ['src/main.cpp', 'src/mqtt.h', 'README.md', 'yok.txt'],
      parallelism: 3
    })
    check('üç dosya okundu', files.length, 3)
    check('içerik doğru', files.some((file) => file.content.includes('int main')), true)
    check('olmayan atlandı', files.some((file) => file.path === 'yok.txt'), false)

    const limited = await prefetchFiles({ root, candidates: ['src/main.cpp'], maxFiles: 1 })
    check('maxFiles uygulandı', limited.length, 1)

    const capped = await prefetchFiles({
      root,
      candidates: ['buyuk.txt'],
      maxFileChars: 1_000
    })
    check('büyük dosya kırpıldı', capped[0]?.truncated, true)
    check('kırpma boyutu', String(capped[0]?.content).length, 1_000)

    const noRoot = await prefetchFiles({ root: null, candidates: ['a.txt'] })
    check('kök yoksa boş', noRoot.length, 0)

    check('en fazla 8 dosya', MAX_PREFETCH, 8)
  }

  // ============ 4) Konuşmaya ekleme ============
  {
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: 'görev' }]
    const added = appendPrefetch(messages, [
      { path: 'a.ts', content: 'içerik a', ok: true },
      { path: 'b.ts', content: 'içerik b', ok: true }
    ])
    check('iki dosya → 3 ileti (1 assistant + 2 tool)', added, 3)
    check('toplam ileti', messages.length, 4)
    check('assistant tool_calls', Array.isArray(messages[1]?.['tool_calls']), true)
    check('tool kimliği eşleşiyor', messages[2]?.['tool_call_id'], 'prefetch-0')
    check('ön okuma etiketi', String(messages[2]?.['content']).startsWith('ÖN OKUMA: a.ts'), true)

    const empty: Array<Record<string, unknown>> = []
    check('boş liste eklemez', appendPrefetch(empty, []), 0)
  }

  // ============ 5) Ön okuma notu ============
  {
    const note = prefetchNote([
      { path: 'a.ts', content: '', ok: true },
      { path: 'b.ts', content: '', ok: true }
    ])
    check('dosyaları listeler', note.includes('a.ts') && note.includes('b.ts'), true)
    check('tekrar okumayı yasaklar', /tekrar okumaya çalışma/i.test(note), true)
    check('boş listede not yok', prefetchNote([]), '')
  }

  // ============ 6) Bağlam boyutu ve kırpma eşiği ============
  {
    const small = [{ role: 'user', content: 'kısa' }]
    check('küçük bağlam ölçümü', contextSize(small), 4)
    check('küçük bağlam kırpılmaz', shouldTrimStale(small), false)

    const big = [{ role: 'tool', content: 'x'.repeat(CACHE_PRESERVE_TRIM_THRESHOLD + 1) }]
    check('büyük bağlam kırpılır', shouldTrimStale(big), true)

    // Blok dizili içerik de sayılır.
    const blocks = [
      { role: 'user', content: [{ type: 'text', text: 'abc' }, { type: 'text', text: 'de' }] }
    ]
    check('blok içerik sayıldı', contextSize(blocks), 5)
  }

  // ============ 7) Anthropic önbellek işaretleri ============
  {
    const body = {
      model: 'm',
      messages: [
        { role: 'system', content: 'sistem' },
        { role: 'user', content: 'soru' }
      ],
      tools: [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }]
    }
    const cached = withAnthropicCache(body) as {
      messages: Array<{ role: string; content: unknown }>
      tools: Array<Record<string, unknown>>
    }
    check('sistem bloğa çevrildi', Array.isArray(cached.messages[0]?.content), true)
    check(
      'sistemde cache_control',
      JSON.stringify(cached.messages[0]?.content).includes('ephemeral'),
      true
    )
    check('kullanıcı iletisi korunur', cached.messages[1]?.content, 'soru')
    check('son araç işaretli', Boolean(cached.tools[1]?.['cache_control']), true)
    check('ilk araç işaretsiz', cached.tools[0]?.['cache_control'], undefined)

    // Sistem yoksa dokunulmaz.
    const noSystem = { messages: [{ role: 'user', content: 'x' }] }
    check('sistem yoksa aynı', withAnthropicCache(noSystem), noSystem)

    // Etkinleştirme.
    process.env['EVREN_PROMPT_CACHE'] = 'off'
    check('env off → kapalı', wantsAnthropicCache('https://anthropic.com'), false)
    process.env['EVREN_PROMPT_CACHE'] = 'anthropic'
    check('env anthropic → açık', wantsAnthropicCache('https://example.com'), true)
    delete process.env['EVREN_PROMPT_CACHE']
    check('anthropic URL → açık', wantsAnthropicCache('https://api.anthropic.com/v1'), true)
    check('başka URL → kapalı', wantsAnthropicCache('https://example.com/v1'), false)
  }

  // ============ 8) Parmak izi ============
  {
    const a = promptFingerprint('sabit sistem istemi')
    const b = promptFingerprint('sabit sistem istemi')
    const c = promptFingerprint('değişmiş sistem istemi')
    check('aynı metin aynı iz', a, b)
    check('farklı metin farklı iz', a === c, false)
    check('uzunluk taşınır', a.endsWith(':19'), true)
  }

  console.log(`TOTAL=40 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
