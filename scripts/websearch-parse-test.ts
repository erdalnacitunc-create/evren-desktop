/// <reference types="node" />
import {
  blockedReason,
  decodeBingRedirect,
  decodeDuckDuckGoRedirect,
  filterRelevantHits,
  formatHits,
  gradeHits,
  looksBlocked,
  markProviderBlocked,
  markProviderSuccess,
  parseBing,
  parseDuckDuckGo,
  parseGoogleCse,
  parseRss,
  preferredProvider,
  providerOrder,
  queryTokens,
  relevanceOf,
  resetProviderMemory,
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
// 0.4.15: RSS yedeği eklendi. DuckDuckGo/Bing HTML bot koruması döndürdüğünde
// tek çalışan kaynak Google News RSS oluyor, bu yüzden her zincirde var.
{
  check(
    'anahtar yoksa duckduckgo önce',
    providerOrder({}),
    ['duckduckgo', 'bing', 'googlenews']
  )
  check(
    'anahtar varsa google önce',
    providerOrder({ googleKey: 'k', googleCx: 'c' }),
    ['google', 'duckduckgo', 'bing', 'googlenews']
  )
  check(
    'zorlanan google anahtarsız yok sayılır',
    providerOrder({ forced: 'google' }),
    ['duckduckgo', 'bing', 'googlenews']
  )
  check(
    'zorlanan duckduckgo',
    providerOrder({ forced: 'duckduckgo', googleKey: 'k', googleCx: 'c' }),
    ['duckduckgo', 'googlenews']
  )
  check('zorlanan bing', providerOrder({ forced: 'bing' }), ['bing', 'googlenews'])
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

// ============ 14) RSS ayrıştırma ============
{
  const xml =
    '<rss><channel>' +
    '<item><title>Ali Slim&apos;s ESP Offline Flasher - Hackster.io</title>' +
    '<link>https://news.google.com/rss/articles/CBMi123?oc=5</link>' +
    '<pubDate>Fri, 22 Sep 2023 18:13:22 GMT</pubDate>' +
    '<description>&lt;a href="https://x"&gt;ESP8266 firmware flasher&lt;/a&gt;</description></item>' +
    '<item><title>Flash ESP32 Home Automation - Embedded.com</title>' +
    '<link>https://news.google.com/rss/articles/CBMi456?oc=5</link>' +
    '<description>esp32 flasher via connectors</description></item>' +
    '<item><title>Bozuk</title><description>link yok</description></item>' +
    '</channel></rss>'
  const hits = parseRss(xml, 8)
  check('RSS iki geçerli sonuç', hits.length, 2)
  check('RSS başlık temiz', hits[0]?.title.includes('ESP Offline Flasher'), true)
  check('RSS bağlantı', hits[0]?.url.startsWith('https://news.google.com/'), true)
  check('RSS tarih taşındı', hits[0]?.published, 'Fri, 22 Sep 2023 18:13:22 GMT')
  check('RSS açıklama etiketleri temizlendi', /<\w+/.test(hits[0]?.snippet ?? ''), false)

  const atom =
    '<feed><entry><title>Atom başlık</title>' +
    '<link rel="alternate" href="https://example.com/a"/>' +
    '<summary>esp8266 özet</summary></entry></feed>'
  const atomHits = parseRss(atom, 5)
  check('Atom ayrıştırıldı', atomHits.length, 1)
  check('Atom href kullanıldı', atomHits[0]?.url, 'https://example.com/a')
}

// ============ 15) Alaka süzgeci — canlı çöp sonuçlar ============
{
  const query = 'esp8266 flasher esp32 standalone'
  // 14 Kasım 2026 canlı gözlem: Bing bu sorguya Lidl mağaza bulucu döndürdü.
  const garbage = [
    { title: 'Store Finder - Lidl US', url: 'https://www.lidl.com/c/store-finder', snippet: '' },
    { title: 'Google Maps', url: 'https://www.google.com/maps/search/lidl', snippet: '' },
    { title: 'Lidl Sverige', url: 'https://www.lidl.se/', snippet: '' }
  ]
  check('çöp sonuç uyumu sıfır', relevanceOf(garbage, query), 0)
  check('çöp sonuç süzüldü', filterRelevantHits(garbage, query).length, 0)

  // Aynı canlı koşuda DuckDuckGo'nun döndürdüğü gerçek sonuçlar.
  const good = [
    {
      title: 'Partition Tables - ESP32 - ESP-IDF Programming Guide',
      url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/partition-tables.html',
      snippet: 'esp32 partition table factory app'
    },
    {
      title: 'esp8266 flasher standalone tool',
      url: 'https://github.com/example/esp8266-flasher',
      snippet: 'flash esp32 from esp8266'
    }
  ]
  check('gerçek sonuç uyumu yüksek', relevanceOf(good, query) >= 0.75, true)
  check('gerçek sonuçlar korundu', filterRelevantHits(good, query).length, 2)

  // Karma: alakasız tek satır ayıklanır.
  const mixed = [...good, { title: 'Best Cleveland Birth Injury Attorneys', url: 'https://x.example', snippet: '' }]
  check('karma listede çöp atıldı', filterRelevantHits(mixed, query).length, 2)
}

// ============ 16) Sorgu sözcükleri ============
{
  check('Türkçe etekler atıldı', queryTokens('webde esp8266 flasher ara'), ['esp8266', 'flasher'])
  check('kısa sözcük atıldı', queryTokens('a bc def'), ['def'])
  check('tekrarlar birleşti', queryTokens('esp32 esp32 flasher'), ['esp32', 'flasher'])
  check('boş sorgu', queryTokens('   '), [])
}

// ============ 17) Bot koruması tespiti ============
{
  check('DDG 202 engel', looksBlocked(202, 'anything'), true)
  check('429 engel', looksBlocked(429, ''), true)
  check('captcha metni', looksBlocked(200, '<title>Captcha</title>'), true)
  check('anubis challenge', looksBlocked(200, '{"anubis_challenge":1}'), true)
  check('normal sayfa engel değil', looksBlocked(200, '<html><body>sonuçlar</body></html>'), false)
}

// ============ 18) Sağlayıcı hafızası ============
{
  resetProviderMemory()
  check('başlangıçta tercih yok', preferredProvider(), null)
  check('başlangıçta engel yok', blockedReason('duckduckgo'), null)

  markProviderBlocked('duckduckgo', 'HTTP 202 (bot koruması)', 1_000_000)
  const reason = blockedReason('duckduckgo', 1_000_000)
  check('engel raporlandı', typeof reason === 'string' && reason.includes('202'), true)
  check('süre bilgisi var', String(reason).includes('atlanacak'), true)

  // Cooldown dolunca serbest.
  check('cooldown sonrası serbest', blockedReason('duckduckgo', 1_000_000 + 6 * 60 * 1000), null)

  markProviderSuccess('googlenews')
  check('başarılı sağlayıcı öne alınır', preferredProvider(), 'googlenews')
  const order = providerOrder({ preferred: 'googlenews' })
  check('sıralamada başı çeker', order[0], 'googlenews')
  check('diğerleri korunur', order.length >= 3, true)
  resetProviderMemory()
}

// ============ 19) Sağlayıcı sırası ============
{
  const base = providerOrder({})
  check('anahtarsız Google yok', base.includes('google'), false)
  check('RSS yedek var', base.includes('googlenews'), true)
  const withKey = providerOrder({ googleKey: 'k', googleCx: 'c' })
  check('anahtarla Google başta', withKey[0], 'google')
  check('zorlanan sağlayıcı', providerOrder({ forced: 'bing' })[0], 'bing')
  check('zorlanan RSS', providerOrder({ forced: 'googlenews' })[0], 'googlenews')
}

// ============ 20) gradeHits: çöp reddi + düşük uyum yedeği ============
{
  const query = 'esp8266 flasher esp32 standalone'
  const garbage = gradeHits(
    [
      { title: 'Store Finder - Lidl US', url: 'https://www.lidl.com/x', snippet: '' },
      { title: 'Google Maps', url: 'https://www.google.com/maps', snippet: '' }
    ],
    query
  )
  check('çöp kabul edilmedi', garbage.accepted, false)
  check('çöp sonrası boş', garbage.hits.length, 0)
  check('çöp uyumu sıfır', garbage.score, 0)

  const good = gradeHits(
    [
      { title: 'esp8266 flasher standalone', url: 'https://github.com/a/b', snippet: 'esp32 flash' },
      { title: 'ESP32 flasher projesi', url: 'https://example.com/c', snippet: 'esp8266' }
    ],
    query
  )
  check('iyi sonuç kabul', good.accepted, true)
  check('iyi sonuç korundu', good.hits.length, 2)

  // Türkçe sorgu: sözcük örtüşmesi aranmaz (İngilizce sonuçlarla eşleşmez).
  const turkish = gradeHits(
    [{ title: 'esp8266 flasher tool', url: 'https://github.com/x/y', snippet: '' }],
    'benzer açık kaynak projeleri'
  )
  check('Türkçe sorgu kabul edilir', turkish.accepted, true)
  check('Türkçe sorguda sonuç korunur', turkish.hits.length, 1)

  // İngilizce sorgu + örtüşmeyen sonuç: eşik geçmez ama aday saklanır.
  const weak = gradeHits(
    [{ title: 'tamamen ilgisiz bir sayfa', url: 'https://example.com/z', snippet: '' }],
    'quantum chromodynamics lattice'
  )
  check('zayıf eşleşme kabul edilmez', weak.accepted, false)
}

console.log(`TOTAL=86 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
