/// <reference types="node" />
import {
  decodeBingRedirect,
  decodeDuckDuckGoRedirect,
  formatHits,
  parseBing,
  parseDuckDuckGo,
  parseGoogleCse,
  providerOrder,
  stripHtml
} from '../src/main/agent/websearch'

/**
 * Web arama ayrıştırıcı testleri (saf mantık, ağ yok).
 * Çalıştırma: node scripts/run-unit.cjs scripts/websearch-parse-test.ts
 *
 * ## Canlı kusur
 *
 * `websearch` "Electron utilityProcess documentation" sorgusuna WhatsApp
 * indirme linkleri döndürdü. Ölçüm: Bing otomatik isteklere 200 döndürüyor
 * ama HTML'de `b_algo` **0**, `h2` **0** — yani sonuç yok, yalnızca reklam
 * blokları var. Ayrıştırıcı bozuk değildi, kaynak boştu.
 *
 * Bu yüzden sağlayıcı zinciri eklendi: Google CSE → DuckDuckGo → Bing.
 * DuckDuckGo aynı sorguya 10 doğru sonuç verdi (electronjs.org).
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

// ============ 1) stripHtml ============
{
  check('etiket temizler', stripHtml('<b>kalın</b> metin'), 'kalın metin')
  check('entity çözer', stripHtml('a &amp; b'), 'a & b')
  check('nbsp', stripHtml('a&nbsp;b'), 'a b')
  check('script atar', stripHtml('a<script>x</script>b'), 'a b')
  check('boşluk sadeleşir', stripHtml('a   b\n\nc'), 'a b c')
  check('tırnak', stripHtml('&quot;test&quot;'), '"test"')
  check('sayısal entity', stripHtml('&#65;'), 'A')
}

// ============ 2) DDG yönlendirme çözümü ============
{
  const redirect =
    '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.electronjs.org%2Fdocs%2Flatest%2Fapi%2Futility-process&rut=x'
  check(
    'uddg çözüldü',
    decodeDuckDuckGoRedirect(redirect),
    'https://www.electronjs.org/docs/latest/api/utility-process'
  )
  check('doğrudan URL', decodeDuckDuckGoRedirect('https://example.com/a'), 'https://example.com/a')
  check('boş', decodeDuckDuckGoRedirect(''), '')
  check('ddg iç bağlantı reddedilir', decodeDuckDuckGoRedirect('https://duckduckgo.com/y.js?x=1'), '')
}

// ============ 3) DDG ayrıştırma ============
{
  const html = `
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.electronjs.org%2Fdocs%2Flatest%2Fapi%2Futility-process">utilityProcess - Electron</a>
      <a class="result__snippet">utilityProcess creates a child process with Node.js and Message ports enabled.</a>
    </div>
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsqlite.org%2Fwal.html">SQLite WAL</a>
      <a class="result__snippet">Write-Ahead Logging mode.</a>
    </div>
  `
  const hits = parseDuckDuckGo(html, 8)
  check('iki sonuç', hits.length, 2)
  check('ilk başlık', hits[0]?.title, 'utilityProcess - Electron')
  check('ilk URL', hits[0]?.url, 'https://www.electronjs.org/docs/latest/api/utility-process')
  check('ilk özet', hits[0]?.snippet?.startsWith('utilityProcess creates'), true)
  check('ikinci URL', hits[1]?.url, 'https://sqlite.org/wal.html')
}

// ============ 4) DDG: limit ve tekrar ============
{
  const block = (url: string, title: string): string =>
    `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}">${title}</a>`
  const html = [
    block('https://a.example/1', 'A1'),
    block('https://a.example/1', 'A1 tekrar'),
    block('https://a.example/2', 'A2'),
    block('https://a.example/3', 'A3'),
    block('https://a.example/4', 'A4')
  ].join('\n')

  check('tekrar ayıklandı', parseDuckDuckGo(html, 8).length, 4)
  check('limit uygulandı', parseDuckDuckGo(html, 2).length, 2)
}

// ============ 5) DDG: boş sayfa ============
{
  check('sonuçsuz HTML', parseDuckDuckGo('<html><body>hiçbir şey</body></html>', 8), [])
  check('boş string', parseDuckDuckGo('', 8), [])
}

// ============ 6) Bing ayrıştırma (son çare) ============
{
  const html = `
    <li class="b_algo">
      <h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9h">Örnek Başlık</a></h2>
      <p>Örnek özet metni.</p>
    </li>
  `
  const hits = parseBing(html, 8)
  check('bing bir sonuç', hits.length, 1)
  check('bing başlık', hits[0]?.title, 'Örnek Başlık')
  check('bing özet', hits[0]?.snippet, 'Örnek özet metni.')
}

// ============ 7) Bing: sonuçsuz sayfa (canlı kusur) ============
{
  // Gerçek gözlem: 200 dönen ama b_algo içermeyen sayfa.
  const blocked = '<html><body><div id="b_results"><li class="b_no">sonuç yok</li></div></body></html>'
  check('sonuçsuz bing → boş', parseBing(blocked, 8), [])
}

// ============ 8) Bing yönlendirme ============
{
  const decoded = decodeBingRedirect(
    'https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYWdl&x=1'
  )
  check('bing base64 çözüldü', decoded, 'https://example.com/page')
  check('bing düz URL', decodeBingRedirect('https://example.com/x'), 'https://example.com/x')
  check('bing boş', decodeBingRedirect(''), '')
}

// ============ 9) Google CSE ============
{
  const payload = {
    items: [
      { title: 'Başlık <b>1</b>', link: 'https://a.example', snippet: 'Özet <b>1</b>' },
      { title: 'Başlık 2', link: 'https://b.example', snippet: 'Özet 2' },
      { title: '', link: 'https://c.example', snippet: 'boş başlık' }
    ]
  }
  const hits = parseGoogleCse(payload, 8)
  check('boş başlık atıldı', hits.length, 2)
  check('html temizlendi', hits[0]?.title, 'Başlık 1')
  check('link korundu', hits[0]?.url, 'https://a.example')
  check('bozuk yük güvenli', parseGoogleCse(null, 8), [])
  check('items yok', parseGoogleCse({}, 8), [])
}

// ============ 10) Biçimlendirme ============
{
  const text = formatHits(
    [{ title: 'T', url: 'https://x.example', snippet: 'S' }],
    'DuckDuckGo',
    'sorgu'
  )
  check('sağlayıcı adı görünür', text.includes('DuckDuckGo'), true)
  check('sorgu görünür', text.includes('sorgu'), true)
  check('numaralandırma', text.includes('1. T'), true)
  check('URL satırı', text.includes('https://x.example'), true)
  check('özet satırı', text.includes('S'), true)

  const empty = formatHits([], 'Bing', 'q')
  check('boş sonuç mesajı', empty.includes('sonucu bulunamadı'), true)
}

// ============ 11) Sağlayıcı sırası ============
{
  check(
    'anahtar yoksa duckduckgo önce',
    providerOrder({}),
    ['duckduckgo', 'bing']
  )
  check(
    'anahtar varsa google önce',
    providerOrder({ googleKey: 'k', googleCx: 'c' }),
    ['google', 'duckduckgo', 'bing']
  )
  check(
    'zorlanan google anahtarsız yok sayılır',
    providerOrder({ forced: 'google' }),
    ['duckduckgo', 'bing']
  )
  check(
    'zorlanan duckduckgo',
    providerOrder({ forced: 'duckduckgo', googleKey: 'k', googleCx: 'c' }),
    ['duckduckgo', 'bing']
  )
  check('zorlanan bing', providerOrder({ forced: 'bing' }), ['bing', 'duckduckgo'])
}

// ============ 12) Gerçek DDG çıktısıyla (kaydedilmiş örnek) ============
{
  // Canlı koşudan alınan yapı: 10 result__a, ilki electronjs.org
  const html =
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.electronjs.org%2Fdocs%2Flatest%2Fapi%2Futility-process">utilityProcess - Electron</a>' +
    '<a class="result__snippet">utilityProcess creates a child process with Node.js and Message ports enabled.</a>'
  const hits = parseDuckDuckGo(html, 8)
  check('canlı biçim ayrıştırıldı', hits.length, 1)
  check('electronjs URL', hits[0]?.url.includes('electronjs.org'), true)
}

// ============ 13) Deterministik ============
{
  const html = '<a class="result__a" href="https://x.example">X</a>'
  check('aynı girdi aynı çıktı', JSON.stringify(parseDuckDuckGo(html)), JSON.stringify(parseDuckDuckGo(html)))
}

console.log(`TOTAL=46 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
