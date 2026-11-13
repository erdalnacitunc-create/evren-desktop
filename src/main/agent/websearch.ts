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
      `${index + 1}. ${hit.title}\n   ${hit.url}${hit.snippet ? `\n   ${hit.snippet}` : ''}`
  )
  return `Arama (${provider}): ${query}\n\n${lines.join('\n\n')}`
}

/** Sağlayıcı adları — zincir sırası ve log. */
export type SearchProvider = 'google' | 'duckduckgo' | 'bing'

export interface SearchAttempt {
  provider: SearchProvider
  hits: SearchHit[]
  /** Sağlayıcı denendi mi / neden atlandı. */
  note?: string
}

/** Sağlayıcı sırasını belirler. Google yalnızca anahtar varsa. */
export function providerOrder(options: {
  googleKey?: string
  googleCx?: string
  forced?: string
}): SearchProvider[] {
  const hasGoogle = Boolean(options.googleKey && options.googleCx)
  const forced = (options.forced ?? '').toLowerCase()
  if (forced === 'google' && hasGoogle) return ['google', 'duckduckgo']
  if (forced === 'duckduckgo') return ['duckduckgo', 'bing']
  if (forced === 'bing') return ['bing', 'duckduckgo']
  return hasGoogle ? ['google', 'duckduckgo', 'bing'] : ['duckduckgo', 'bing']
}
