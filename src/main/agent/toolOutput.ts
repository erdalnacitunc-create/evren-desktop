/**
 * Araç çıktısı kırpma — model bağlamını şişirmeden tutmak.
 *
 * ## Neden (OpenAI `ToolOutputTrimmer` ile aynı ilke)
 *
 * OpenAI Agents SDK, `ToolOutputTrimmer` ile eski turlardaki büyük araç
 * çıktılarını önizlemeye indirir: *"Agentic applications often accumulate
 * large tool outputs (search results, code execution output, error analyses)
 * that consume significant tokens but lose relevance as the conversation
 * progresses."*
 *
 * Bizde hiç sınır yoktu. Canlı ölçüm: tek bir `webfetch` **93 984 karakter**
 * döndürdü ve olduğu gibi mesajlara girdi. Her sonraki adımda bu metin tekrar
 * gönderildiği için:
 *  - giriş token'ı ve dolayısıyla gecikme artıyor,
 *  - model dikkati dağılıyor,
 *  - düşük RAM'li makinelerde bağlam belleği şişiyor.
 *
 * ## Strateji
 *
 * 1. **Girişte sınır:** her araç sonucu profil sınırına kırpılır. Baş ve son
 *    korunur, orta kısım işaretlenir — dosya listelerinde baş, hata
 *    çıktılarında son önemlidir.
 * 2. **Eski turlarda agresif kırpma:** son N kullanıcı turundan önceki büyük
 *    çıktılar kısa önizlemeye indirilir; son tur tam kalır.
 *
 * Kırpma **kayıpsızdır** denemez: içerik kesilir. Bu bilinçli bir takastır —
 * modele "şu dosyayı tekrar oku" demek, 93 KB'ı 10 kez taşımaktan ucuzdur.
 * Kırpma notu bunu modele açıkça söyler.
 */

/** Çıktısı büyük olabilen ve kırpılması güvenli araçlar. */
const TRIMMABLE_TOOLS = new Set([
  'read_file',
  'run_command',
  'execute',
  'webfetch',
  'websearch',
  'grep',
  'glob',
  'list_files',
  'code_search',
  'repo_map',
  'git',
  'usb_devices'
])

/**
 * Kırpılmaması gereken araçlar.
 *
 * `task_wait` bir alt ajanın **raporunu** taşır; kırpılırsa bilgi kaybı olur ve
 * 0.4.14'te kaybolan sonuçların benzeri yeniden yaşanır. `spawn_agent` yanıtı
 * kısa zaten.
 */
const NEVER_TRIM = new Set(['task_wait', 'task_status', 'task_list', 'spawn_agent', 'todo_write'])

export function isTrimmableTool(name: string): boolean {
  return TRIMMABLE_TOOLS.has(name)
}

export interface TrimOptions {
  /** Bu uzunluğun altındaki çıktılar dokunulmadan kalır. */
  maxChars: number
  /** Baştan korunacak oran (0…1). */
  headRatio?: number
  /** Etiket: kırpma notunda gösterilir. */
  label?: string
}

/**
 * Metni baş + kırpma notu + son biçiminde kısaltır.
 *
 * Neden baş ve son: dosya listelerinde ilk satırlar (kök yapı), hata
 * çıktılarında son satırlar (asıl hata) taşır. Ortayı atmak en yüksek bilgi
 * yoğunluğunu korur.
 */
export function trimToolOutput(text: string, options: TrimOptions): string {
  const value = String(text ?? '')
  const max = Math.max(200, Math.round(options.maxChars))
  if (value.length <= max) return value

  const headRatio = Math.min(0.9, Math.max(0.1, options.headRatio ?? 0.6))
  // Notun kendisi de yer kaplar; 200 karakter pay bırak.
  const budget = max - 200
  const headChars = Math.round(budget * headRatio)
  const tailChars = budget - headChars

  const head = value.slice(0, headChars)
  const tail = tailChars > 0 ? value.slice(value.length - tailChars) : ''
  const omitted = value.length - head.length - tail.length
  const label = options.label ? ` (${options.label})` : ''

  return (
    `${head}\n\n… [${omitted.toLocaleString('tr-TR')} karakter kırpıldı${label}; ` +
    `tamamı ${value.length.toLocaleString('tr-TR')} kr. Gerekirse aracı daha dar kapsamla ` +
    `tekrar çağır] …\n\n${tail}`
  )
}

export interface TrimmableMessage {
  role?: string
  content?: unknown
  tool_call_id?: string
  tool_calls?: unknown
}

/**
 * Konuşmadaki eski araç çıktılarını kısaltır.
 *
 * Son `recentTurns` kullanıcı iletisinden **sonraki** her şey tam kalır: model
 * üzerinde çalıştığı bağlamı kaybetmez. Daha eski ve büyük çıktılar önizlemeye
 * iner.
 *
 * `toolNameOf` verilmezse tüm büyük çıktılar adaydır (OpenAI'nin
 * `trimmable_tools=None` davranışı).
 */
export function trimStaleToolOutputs<T extends TrimmableMessage>(
  messages: T[],
  options: {
    recentTurns?: number
    maxChars: number
    previewChars: number
    toolNameOf?: (message: T) => string | undefined
    trimmableTools?: (name: string | undefined) => boolean
  }
): { messages: T[]; trimmedCount: number } {
  const recentTurns = Math.max(0, Math.round(options.recentTurns ?? 2))
  const maxChars = Math.max(200, Math.round(options.maxChars))
  const previewChars = Math.max(80, Math.round(options.previewChars))
  const trimmable = options.trimmableTools ?? ((name?: string) => (name ? isTrimmableTool(name) : true))

  // Sondan geriye `recentTurns` kadar kullanıcı iletisi say; sınırı bul.
  let boundary = 0
  if (recentTurns > 0) {
    let seen = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        seen += 1
        if (seen >= recentTurns) {
          boundary = index
          break
        }
      }
    }
  }

  let trimmedCount = 0
  const next = messages.map((message, index) => {
    if (index >= boundary) return message
    if (message?.role !== 'tool') return message
    if (typeof message.content !== 'string') return message
    if (message.content.length <= maxChars) return message
    const name = options.toolNameOf?.(message)
    if (!name || NEVER_TRIM.has(name) || !trimmable(name)) return message

    trimmedCount += 1
    const preview = message.content.slice(0, previewChars)
    return {
      ...message,
      content:
        `${preview}\n\n… [eski araç çıktısı kısaltıldı: ${message.content.length.toLocaleString('tr-TR')} → ` +
        `${previewChars} kr. Gerekirse aracı tekrar çağır]`
    } as T
  })

  return { messages: trimmedCount > 0 ? next : messages, trimmedCount }
}
