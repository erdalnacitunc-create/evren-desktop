/**
 * Yanlış araç adı önerisi.
 *
 * Model bazen var olmayan bir araç çağırır (`run_code`, `bash`, `read` …).
 * Sadece "Bilinmeyen araç" demek modelin bir turunu boşa harcatır: canlı
 * koşuda `run_code` çağrısı bir adım kaybettirdi, çünkü doğru ad `execute`
 * idi ve hata mesajı bunu söylemiyordu.
 *
 * Bu modül saf fonksiyondur: verilen adı mevcut araçlarla karşılaştırır ve
 * makul bir öneri döndürür. Eşik altında kalırsa `null` döner — uydurma
 * öneri yanlış aracı çalıştırmaya yol açabilir.
 */

/**
 * Modellerin sık kullandığı yabancı adlar → bizdeki karşılığı.
 * Yalnızca hedef araç gerçekten varsa önerilir.
 */
const ALIASES: Record<string, string> = {
  run_code: 'execute',
  execute_code: 'execute',
  code: 'execute',
  python: 'run_python',
  py: 'run_python',
  bash: 'run_command',
  sh: 'run_command',
  shell: 'run_command',
  cmd: 'run_command',
  terminal: 'run_command',
  run: 'run_command',
  exec: 'run_command',
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  patch: 'edit_file',
  ls: 'list_files',
  list: 'list_files',
  dir: 'list_files',
  find: 'glob',
  search: 'grep',
  rg: 'grep',
  fetch: 'web_fetch',
  browse: 'browser',
  todo: 'todo_write',
  todos: 'todo_write',
  task: 'todo_write',
  usb: 'usb_devices',
  adb: 'adb_devices'
}

/** Küçük harfe indirger, alfanümerik olmayanları atar. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Takma adlar da normalize edilir: `run_code` → `runcode`. */
const NORMALIZED_ALIASES = new Map<string, string>(
  Object.entries(ALIASES).map(([key, value]) => [normalize(key), value])
)

/** Levenshtein mesafesi (iki satır bellek). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      )
    }
    previous = current
  }
  return previous[b.length] ?? Math.max(a.length, b.length)
}

/**
 * En yakın aracı önerir; yeterince yakın değilse `null`.
 *
 * Sıra:
 *  1. Bilinen takma ad eşlemesi (hedef mevcutsa)
 *  2. Birebir normalize eşleşme (`Read_File` → `read_file`)
 *  3. Düzenleme mesafesi (uzunluğa göre ölçekli eşik)
 */
export function suggestTool(name: string, available: string[]): string | null {
  const wanted = normalize(name)
  if (!wanted) return null
  const set = new Set(available)
  const normalized = new Map<string, string>()
  for (const tool of available) normalized.set(normalize(tool), tool)

  const alias = NORMALIZED_ALIASES.get(wanted)
  if (alias && set.has(alias)) return alias

  const exact = normalized.get(wanted)
  if (exact) return exact

  // Önek/alt dize eşleşmesi: "readfile" → "read_file"
  for (const [key, tool] of normalized) {
    if (key.length >= 4 && (key.startsWith(wanted) || wanted.startsWith(key))) return tool
  }

  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const tool of available) {
    const distance = editDistance(wanted, normalize(tool))
    if (distance < bestDistance) {
      bestDistance = distance
      best = tool
    }
  }
  if (!best) return null
  // Eşik: kısa adlarda 2, uzun adlarda uzunluğun üçte biri (en çok 3).
  const limit = Math.min(3, Math.max(1, Math.floor(wanted.length / 3)))
  return bestDistance <= limit ? best : null
}

/** Modele verilecek hata metni. Öneri yoksa yalnızca açıklama döner. */
export function unknownToolMessage(name: string, available: string[]): string {
  const suggestion = suggestTool(name, available)
  if (!suggestion) {
    return `Bilinmeyen araç: ${name}. Kullanılabilir araç listesinden birini seç.`
  }
  return `Bilinmeyen araç: ${name}. Bunu mu demek istediniz: ${suggestion}? Aynı işi ${suggestion} ile tekrar deneyin.`
}
