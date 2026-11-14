/**
 * Web arama — sağlayıcı zinciri ve saf HTML ayrıştırıcıları.
 *
 * ## Neden bu modül
 *
 * Canlı testte `websearch` "Electron utilityProcess documentation" sorgusuna
 * **WhatsApp indirme linkleri** döndürdü. Kök neden: Bing, otomatik isteklere
 * sonuç sayfası yerine reklam/derecelendirilmiş sayfa veriyor. Ölçüm:
 *
 *   GET bing.com/search?q=Electron+utilityProcess  →  200, 97 KB HTML,
 *   `<li class="b_algo">` sayısı: 0, `<h2>` sayısı: 0
 *
 * Yani ayrıştırıcı bozuk değildi; **kaynak boştu**. Bu yüzden tek sağlayıcıya
 * bağlı kalmak doğru değil: zincir hâlinde denenmeli.
 *
 * Ölçülen sağlayıcılar (13 Kasım 2026, bu makine):
 *
 * | Sağlayıcı | Durum | Sonuç |
 * |---|---|---|
 * | DuckDuckGo HTML | 200, ~33 KB | **10 doğru sonuç** |
 * | DuckDuckGo Lite | 200 | 0 sonuç (ayrıştırma farklı) |
 * | Brave HTML | 429 | engellendi |
 * | Wikipedia API | 200 | yalnızca ansiklopedik |
 * | Bing HTML | 200 ama sonuçsuz | reklam blokları |
 * | Google CSE | anahtar gerekir | anahtar varsa en iyi |
 *
 * Sıra: Google CSE (anahtar varsa) → DuckDuckGo → Bing (son çare).
 *
 * Ayrıştırıcılar **saf fonksiyon**: ağ yok, test edilebilir
 * (`websearch-parse-test`).
 */

export interface SearchHit {
  title: string
  url: string
  snippet: string
  /** RSS/Atom kaynaklıysa yayın tarihi. */
  published?: string
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

/** HTML etiketlerini ve fazla boşluğu temizler. */
export function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim()
}

/**
 * DuckDuckGo yönlendirme URL'sini çözer.
 *
 * DDG sonuçları `//duckduckgo.com/l/?uddg=<urlencoded>` biçiminde gelir.
 */
export function decodeDuckDuckGoRedirect(href: string): string {
  try {
    const normalized = decodeEntities(href).trim()
    if (!normalized) return ''
    const absolute = normalized.startsWith('//') ? `https:${normalized}` : normalized
    const parsed = new URL(absolute, 'https://duckduckgo.com')
    const target = parsed.searchParams.get('uddg')
    if (target) {
      const decoded = decodeURIComponent(target)
      if (/^https?:\/\//i.test(decoded)) return decoded
    }
    if (/^https?:\/\//i.test(absolute) && !/duckduckgo\.com\/(l|y\.js)/i.test(absolute)) {
      return absolute
    }
  } catch {
    // yut
  }
  return ''
}

/** Bing yönlendirmesini çözer (`/ck/a?...&u=a1<base64url>`). */
export function decodeBingRedirect(href: string): string {
  try {
    const normalized = decodeEntities(href)
    const parsed = new URL(normalized, 'https://www.bing.com')
    const encoded = parsed.searchParams.get('u')
    if (encoded?.startsWith('a1')) {
      const decoded = Buffer.from(encoded.slice(2), 'base64url').toString('utf8')
      if (/^https?:\/\//i.test(decoded)) return decoded
    }
    if (/^https?:\/\//i.test(normalized)) return normalized
  } catch {
    // yut
  }
  return ''
}

/**
 * DuckDuckGo HTML sonuç sayfasını ayrıştırır.
 *
 * Yapı: her sonuç `<a class="result__a" href="…">Başlık</a>` ve
 * `<a class="result__snippet">…</a>` içerir.
 */
export function parseDuckDuckGo(html: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  const linkPattern =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(linkPattern)) {
    const url = decodeDuckDuckGoRedirect(match[1] ?? '')
    const title = stripHtml(match[2] ?? '')
    if (!url || !title || seen.has(url)) continue
    seen.add(url)
    hits.push({ title, url, snippet: '' })
    if (hits.length >= limit) break
  }

  // Özetleri sırayla eşleştir (title ile aynı blokta değiller).
  const snippets = [
    ...html.matchAll(
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    )
  ].map((match) => stripHtml(match[1] ?? '').slice(0, 320))

  for (const [index, hit] of hits.entries()) {
    if (snippets[index]) hit.snippet = snippets[index]
  }
  return hits
}

/**
 * Bing HTML sonuç sayfasını ayrıştırır.
 *
 * DOM değiştiğinde tek seçiciye bağlı kalmamak için üç desen denenir. Sonuç
 * boşsa çağıran zincirdeki bir sonraki sağlayıcıya geçer.
 */
export function parseBing(html: string, limit = 8): SearchHit[] {
  const blocks =
    html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ??
    html.match(/<li class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/g) ??
    []
  const hits: SearchHit[] = []
  for (const block of blocks.slice(0, limit)) {
    const match = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!match) continue
    const title = stripHtml(match[2] ?? '')
    const url = decodeBingRedirect(match[1] ?? '')
    if (!title || !url) continue
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    hits.push({
      title,
      url,
      snippet: snippetMatch ? stripHtml(snippetMatch[1] ?? '').slice(0, 320) : ''
    })
  }
  return hits
}

/** Google Custom Search JSON yanıtını ayrıştırır. */
export function parseGoogleCse(payload: unknown, limit = 8): SearchHit[] {
  const items = (payload as { items?: Array<{ title?: string; link?: string; snippet?: string }> })
    ?.items
  if (!Array.isArray(items)) return []
  return items
    .slice(0, limit)
    .map((item) => ({
      title: stripHtml(item.title ?? ''),
      url: item.link ?? '',
      snippet: stripHtml(item.snippet ?? '').slice(0, 320)
    }))
    .filter((hit) => hit.title && hit.url)
}

/** Sonuçları modele verilecek metne çevirir. */
export function formatHits(hits: SearchHit[], provider: string, query: string): string {
  if (hits.length === 0) return `"${query}" için ${provider} sonucu bulunamadı.`
  const lines = hits.map(
    (hit, index) =>
      `${index + 1}. ${hit.title}\n   ${hit.url}${hit.snippet ? `\n   ${hit.snippet}` : ''}` +
      (hit.published ? `\n   (${hit.published})` : '')
  )
  return `Arama (${provider}): ${query}\n\n${lines.join('\n\n')}`
}

/**
 * Sağlayıcı sırasını belirler.
 *
 * Sıra **ölçüme** dayanır (14 Kasım 2026, bu ağ): DuckDuckGo çalıştığında en
 * iyi sonucu verir ama sık sık 202/captcha döner; Bing HTML çöp döndürür;
 * Google News RSS her zaman çalışır ama haber ağırlıklıdır. Bu yüzden önce
 * kaliteli olanlar denenir, RSS son yedek olarak kalır.
 *
 * `preferred` verilirse (bu süreçte en son başarılı sağlayıcı) başa alınır —
 * aynı oturumda tekrar tekrar bloklu sağlayıcıyı denemek 9/15 hataya yol
 * açıyordu.
 */
export function providerOrder(options: {
  googleKey?: string
  googleCx?: string
  forced?: string
  preferred?: SearchProvider | null
}): SearchProvider[] {
  const hasGoogle = Boolean(options.googleKey && options.googleCx)
  const forced = (options.forced ?? '').toLowerCase()

  const base: SearchProvider[] = hasGoogle
    ? ['google', 'duckduckgo', 'bing', 'googlenews']
    : ['duckduckgo', 'bing', 'googlenews']

  if (forced === 'google' && hasGoogle) base.splice(0, base.length, 'google', 'googlenews')
  else if (forced === 'duckduckgo') base.splice(0, base.length, 'duckduckgo', 'googlenews')
  else if (forced === 'bing') base.splice(0, base.length, 'bing', 'googlenews')
  else if (forced === 'googlenews') base.splice(0, base.length, 'googlenews')

  const preferred = options.preferred
  if (preferred && base.includes(preferred)) {
    return [preferred, ...base.filter((provider) => provider !== preferred)]
  }
  return base
}

/** Sağlayıcı adları — zincir sırası ve log. */
export type SearchProvider = 'google' | 'duckduckgo' | 'bing' | 'googlenews'

/**
 * RSS/Atom yanıtını sonuçlara çevirir.
 *
 * ## Neden RSS
 *
 * 14 Kasım 2026 ölçümü (bu makine, gerçek sorgu):
 *
 * | Uç | Sonuç |
 * |---|---|
 * | DuckDuckGo HTML | HTTP 202 + captcha sayfası (rate-limit) |
 * | Bing HTML | HTTP 200 ama **alakasız içerik** ("Lidl mağaza bulucu", "Esther D'Aoust") |
 * | Bing HTML `&count=8&setlang=en&cc=us` | HTTP 200, `b_algo=0` — JS kabuğu |
 * | Mojeek | captcha |
 * | Startpage / Yandex / SearXNG | Anubis / captcha |
 * | Brave / Ecosia | 429 / 403 |
 * | **Google News RSS** | **HTTP 200, ilgili sonuçlar** (Hackaday, Hackster.io) |
 *
 * Yani HTML kazıma bu ağdan fiilen çalışmıyor; RSS ucu çalışıyor. RSS'in
 * sınırı: haber/duyuru ağırlıklı. Bu yüzden zincirin *son* halkası, daha iyi
 * bir kaynak yoksa kullanılan yedek.
 */
export function parseRss(xml: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  const pattern = /<(item|entry)>([\s\S]*?)<\/\1>/gi
  for (const match of xml.matchAll(pattern)) {
    const block = match[2] ?? ''
    const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? ''
    // Google News başlığı "Makale Adı - Yayıncı" biçiminde; yayıncıyı ayır.
    const title = stripHtml(rawTitle).replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()
    let url = stripHtml(/<link[^>]*>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? '')
    if (!url) {
      // Atom: <link rel="alternate" href="…"/>
      url = decodeEntities(/<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? '')
    }
    const rawDesc =
      /<description[^>]*>([\s\S]*?)<\/description>/i.exec(block)?.[1] ??
      /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(block)?.[1] ??
      ''
    const snippet = stripHtml(rawDesc.replace(/&lt;/g, '<').replace(/&gt;/g, '>')).slice(0, 320)
    const published = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1]?.trim()
    if (!title || !url || !/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    hits.push({ title, url, snippet, ...(published ? { published } : {}) })
    if (hits.length >= limit) break
  }
  return hits
}

/**
 * Sorguyla ilgisiz sonuçları ayıklar.
 *
 * ## Neden
 *
 * Bing, otomatik isteklere **başka bir sorgunun** sonuç sayfasını döndürüyor
 * (14 Kasım 2026: "esp8266 flasher" → Lidl mağaza bulucu; "ESP8266 auto reset"
 * → Cleveland doğum hasarı avukatı). Bunlar "sonuç var" diye kabul edilirse
 * model yanlış kaynaklara dayanır — 0.4.14 canlı koşusunda tam olarak bu oldu.
 *
 * Ölçüt: sorgu sözcüklerinin kaçı sonuç metinlerinde geçiyor? Hiçbiri
 * geçmiyorsa sağlayıcı **çöp** sayılır ve zincirdeki sonraki denenir.
 */
export function queryTokens(query: string): string[] {
  const stop = new Set([
    'the', 'and', 'for', 'with', 'without', 'from', 'that', 'this', 'how', 'what', 'why',
    'webde', 'ara', 'için', 'ile', 'bir', 've', 'veya', 'gibi', 'olan', 'nasıl', 'hangi'
  ])
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3 && !stop.has(token))
  )]
}

/**
 * Sonuç kümesinin sorguyla örtüşme oranı (0…1).
 *
 * Sözcüğün en az ilk 4 karakteri aranır: Türkçe ekler ve "esp8266/ESP8266"
 * gibi biçim farkları eşleşsin.
 */
export function relevanceOf(hits: SearchHit[], query: string): number {
  const tokens = queryTokens(query)
  if (tokens.length === 0 || hits.length === 0) return 0
  const haystack = hits
    .map((hit) => `${hit.title} ${hit.snippet} ${hit.url}`)
    .join(' ')
    .toLowerCase()
  const matched = tokens.filter((token) => haystack.includes(token.slice(0, 4))).length
  return matched / tokens.length
}

/**
 * Her sonucu tek tek süzer: sorguyla hiç örtüşmeyen başlık atılır.
 *
 * Küresel oran yeterliyse bile tek tek elemek gerekir: Bing bazen ilk 3
 * sonucu doğru, kalanını alakasız döndürüyor.
 */
export function filterRelevantHits(hits: SearchHit[], query: string): SearchHit[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return hits
  return hits.filter((hit) => {
    const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase()
    return tokens.some((token) => text.includes(token.slice(0, 4)))
  })
}

/** Sağlayıcı yanıtı bot koruması mı? */
export function looksBlocked(status: number, body: string): boolean {
  if (status === 202 || status === 403 || status === 429) return true
  if (status >= 500) return true
  const probe = body.slice(0, 6000).toLowerCase()
  return /captcha|anomaly|unusual traffic|verifying your browser|anubis_challenge|are you a robot|access denied/.test(
    probe
  )
}

export interface GradedHits {
  /** Eşik geçildi mi? Geçilmediyse sonuçlar "en yakın eşleşme"dir. */
  accepted: boolean
  /** Alakasız satırlar ayıklandıktan sonra kalanlar. */
  hits: SearchHit[]
  /** Sorgu örtüşme oranı (0…1). */
  score: number
}

/**
 * Sağlayıcı sonuçlarını notlar: alakasızları atar, uyum oranını hesaplar.
 *
 * Ayrı saf fonksiyon çünkü iki karar var ve test edilebilir olmalı:
 *  1. **Alaka** — Bing başka sorgunun sayfasını döndürüyor; çöp kabul edilmez.
 *  2. **Düşük uyum yedeği** — Türkçe sorgularda İngilizce sonuçlar hiçbir
 *     sözcükle örtüşmeyebilir. Tamamen başarısız olmak yerine en yüksek
 *     uyumlu kümeyi "düşük uyum" notuyla döndürmek daha yararlı.
 */
export function gradeHits(rawHits: SearchHit[], query: string, minScore = 0.5): GradedHits {
  if (rawHits.length === 0) return { accepted: false, hits: [], score: 0 }
  // Türkçe sorgularda İngilizce sonuçlarla sözcük örtüşmesi aranmaz: "benzer
  // açık kaynak projeleri" sorgusuna dönen İngilizce sayfalar hiçbir Türkçe
  // sözcüğü içermez. Bu durumda süzgeç uygulamak tüm sonuçları siler.
  if (/[çğıöşüÇĞİÖŞÜ]/.test(query)) {
    return { accepted: true, hits: rawHits, score: relevanceOf(rawHits, query) }
  }
  const hits = filterRelevantHits(rawHits, query)
  const score = relevanceOf(hits, query)
  return { accepted: hits.length > 0 && score >= minScore, hits, score }
}

export interface SearchAttempt {
  provider: SearchProvider
  hits: SearchHit[]
  /** Sağlayıcı denendi mi / neden atlandı. */
  note?: string
}

// ---------------------------------------------------------------------------
// Sağlayıcı hafızası (süreç içi)
// ---------------------------------------------------------------------------

/**
 * Aynı oturumda bloklu sağlayıcıyı tekrar tekrar denemek pahalı: canlı koşuda
 * 15 aramanın 9'u DuckDuckGo'nun 202/captcha yanıtıyla boşa gitti (her biri
 * ~300-500 ms). Bloklanan sağlayıcı bu süre boyunca atlanır.
 */
export const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000

interface ProviderState {
  /** Bu sağlayıcı ne zamana kadar atlanacak. */
  blockedUntil: number
  /** Son blok nedeni (modele raporlanır). */
  blockedNote?: string
}

const providerState = new Map<SearchProvider, ProviderState>()
let lastSuccess: SearchProvider | null = null

export function markProviderBlocked(provider: SearchProvider, note: string, now = Date.now()): void {
  providerState.set(provider, { blockedUntil: now + PROVIDER_COOLDOWN_MS, blockedNote: note })
}

export function markProviderSuccess(provider: SearchProvider): void {
  lastSuccess = provider
  providerState.delete(provider)
}

/** Sağlayıcı şu anda bloklu mu? Blokluysa nedenini döndürür. */
export function blockedReason(provider: SearchProvider, now = Date.now()): string | null {
  const state = providerState.get(provider)
  if (!state) return null
  if (state.blockedUntil <= now) {
    providerState.delete(provider)
    return null
  }
  const seconds = Math.ceil((state.blockedUntil - now) / 1000)
  return `${state.blockedNote ?? 'engellendi'} (${seconds} sn atlanacak)`
}

/** Bu süreçte son başarılı sağlayıcı — sıralamada öne alınır. */
export function preferredProvider(): SearchProvider | null {
  return lastSuccess
}

/** Testler için: hafızayı sıfırlar. */
export function resetProviderMemory(): void {
  providerState.clear()
  lastSuccess = null
}
