/**
 * Prompt önbelleği — sabit öneki koruma.
 *
 * ## Neden
 *
 * Ölçüm: bir adım ortalama 60-90 sn sürüyor ve bunun neredeyse tamamı modelin
 * üretimi. Giriş tarafında ise her adımda **tüm geçmiş yeniden gönderiliyor**
 * (sistem istemi + araç tanımları + tüm araç çıktıları). Sağlayıcılar bunu
 * önbelleğe alabilir — ama yalnızca **bayt bayt aynı önek** için.
 *
 * İki şey bu öneki bozuyordu:
 *
 * 1. **Eski tur kırpma** (`trimStaleToolOutputs`) geçmişin ortasındaki bir
 *    iletiyi değiştiriyor → o noktadan sonrası önbellekten düşüyor. Kırpma
 *    bağlamı küçültüyor ama önbelleği öldürüyor. Doğrusu: kırpmayı yalnızca
 *    bağlam gerçekten büyüdüğünde yapmak.
 * 2. **Değişken sistem istemi.** Sistem iletisi koşu içinde bir kez kuruluyor
 *    (iyi), ama içine kullanıcı metnine bağlı ipuçları gömülüyor. Koşu
 *    içinde sabit kaldığı sürece sorun yok; yine de parmak izi tutup
 *    değişimi günlüğe yazmak tanılamayı kolaylaştırır.
 *
 * ## Sağlayıcı farkı
 *
 * - **OpenAI / DeepSeek / çoğu OpenAI-uyumlu ağ geçidi**: önek önbelleği
 *   otomatik; yalnızca öneki sabit tutmak gerekir.
 * - **Anthropic**: `cache_control: { type: 'ephemeral' }` blokları gerekir.
 *   Bu yüzden istek gövdesine isteğe bağlı olarak eklenir (varsayılan kapalı;
 *   ağ geçidi desteklemiyorsa isteği bozmamak için).
 */

/** Bağlam bu uzunluğu geçmedikçe eski tur kırpma yapılmaz. */
export const CACHE_PRESERVE_TRIM_THRESHOLD = 80_000

/** Toplam ileti karakteri. */
export function contextSize(messages: Array<{ content?: unknown }>): number {
  let total = 0
  for (const message of messages) {
    const content = message?.content
    if (typeof content === 'string') total += content.length
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'string') total += part.length
        else if (part && typeof part === 'object') {
          const text = (part as { text?: unknown }).text
          if (typeof text === 'string') total += text.length
        }
      }
    }
  }
  return total
}

/**
 * Eski tur kırpma şimdi yapılmalı mı?
 *
 * Kırpma önbelleği bozar; yalnızca bağlam şiştiğinde kazançlıdır. Eşik
 * altında dokunmamak, adımlar arası önek önbelleğinin korunmasını sağlar.
 */
export function shouldTrimStale(
  messages: Array<{ content?: unknown }>,
  threshold = CACHE_PRESERVE_TRIM_THRESHOLD
): boolean {
  return contextSize(messages) > threshold
}

/**
 * Anthropic biçimli önbellek işaretleri.
 *
 * Son sistem iletisine ve araç listesine `cache_control` ekler. Yalnızca
 * açıkça etkinleştirildiğinde uygulanır (`EVREN_PROMPT_CACHE=anthropic` veya
 * uç nokta anthropic.com içeriyorsa), çünkü OpenAI-uyumlu ağ geçitleri bu
 * alanı reddedebilir.
 */
export function wantsAnthropicCache(baseUrl: string): boolean {
  const mode = (process.env['EVREN_PROMPT_CACHE'] ?? '').toLowerCase()
  if (mode === 'anthropic') return true
  if (mode === 'off' || mode === 'none') return false
  return /anthropic\.com/i.test(baseUrl)
}

/**
 * İstek gövdesini Anthropic önbellek işaretleriyle düzenler.
 *
 * Sistem iletisi içerik bloğu dizisine çevrilir ve **son bloğa** işaret konur:
 * sabit önek (sistem + araç tanımları) böylece önbelleğe alınır, değişken
 * kısım (geçmiş) sonrasında kalır.
 */
export function withAnthropicCache(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body['messages']
  if (!Array.isArray(messages) || messages.length === 0) return body
  const first = messages[0] as { role?: string; content?: unknown }
  if (first?.role !== 'system') return body

  const text =
    typeof first.content === 'string'
      ? first.content
      : Array.isArray(first.content)
        ? (first.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('\n')
        : ''

  const cached: Record<string, unknown> = {
    ...body,
    messages: [
      {
        role: 'system',
        content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
      },
      ...messages.slice(1)
    ]
  }

  // Araç tanımlarının sonuna da işaret koy: araçlar sistemden sonra gelir ve
  // her adımda aynıdır, dolayısıyla önbelleğin parçası olmalı.
  const tools = cached['tools']
  if (Array.isArray(tools) && tools.length > 0) {
    const copy = tools.slice()
    const last = { ...(copy[copy.length - 1] as Record<string, unknown>) }
    last['cache_control'] = { type: 'ephemeral' }
    copy[copy.length - 1] = last
    cached['tools'] = copy
  }

  return cached
}

/**
 * Sistem istemi parmak izi (tanılama).
 *
 * Koşu içinde sistem istemi değişirse önbellek sıfırlanır; bunu fark etmek
 * için kısa bir özet tutulur. Kriptografik değil, yalnızca değişim tespiti.
 */
export function promptFingerprint(systemText: string): string {
  let hash = 2166136261
  for (let index = 0; index < systemText.length; index += 1) {
    hash ^= systemText.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(16)}:${systemText.length}`
}
