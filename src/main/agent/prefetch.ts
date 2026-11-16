import { promises as fs } from 'fs'
import { isAbsolute, join, normalize, relative } from 'path'
import { performanceProfile } from './hardwareProfile'
import { runWithConcurrency } from './toolRunner'

/**
 * Ön okuma (warm start) — alt ajanın ilk adımını kısaltır.
 *
 * ## Neden
 *
 * Ölçüm (0.4.20 üç fazlı koşu): bir adım ortalama 88 sn, araç payı <%2. Yani
 * sürenin neredeyse tamamı modelin düşünüp yazması. Adım sayısını azaltmanın
 * tek gerçek yolu, modele **ilk adımda bilgiyi hazır vermek**.
 *
 * Alt ajan isteminde zaten hangi dosyaların okunacağı yazılı (ya da `files`
 * sahipliği verilmiş). Model bunları öğrenmek için 2-5 adım harcıyor:
 * listele, sonra tek tek oku, sonra daralt. Bunu biz yapabiliriz.
 *
 * ## Davranış
 *
 * 1. İstemdeki ve `files` listesindeki dosya yolları çıkarılır.
 * 2. En fazla `MAX_PREFETCH` dosya, donanım profilinin paralelliğiyle okunur.
 * 3. Sonuç, gerçek bir araç turu gibi konuşmaya eklenir:
 *    `assistant(tool_calls)` + `tool(result)` çiftleri.
 *
 * Model böylece ilk adımda içeriği görür; "listele → oku" turlarını atlar.
 *
 * ## Sınırlar
 *
 * - Yalnızca **çalışma alanı içindeki** dosyalar (kapsam koruması).
 * - Yalnızca salt-okunur ajanlar (explore/review); yazma yapan ajan kendi
 *   akışını kursun.
 * - Toplam boyut sınırı: çok büyük dosyalar ön okumayı anlamsız kılar.
 */

/** Tek seferde en fazla kaç dosya ön okunur. */
export const MAX_PREFETCH = 8
/** Toplam ön okuma bütçesi (karakter). */
export const MAX_PREFETCH_CHARS = 60_000
/** Tek dosya için üst sınır. */
export const MAX_SINGLE_FILE_CHARS = 20_000

/** Okunabilir dosya uzantıları — ön okumaya değer olanlar. */
const READABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|ya?ml|toml|ini|cfg|conf|c|cc|cpp|h|hpp|cs|java|kt|kts|dart|py|rb|go|rs|php|sql|sh|ps1|bat|html|css|scss|xml|csv|gradle|spec|properties)$/i

/**
 * İstemden ve sahiplik listesinden dosya adaylarını çıkarır.
 *
 * İstemde geçen `dosya.kt`, `src/main.cpp` gibi belirteçler ve `files`
 * listesindeki yollar birleştirilir; tekrarlar atılır, sıra korunur.
 */
export function extractCandidates(prompt: string, ownedFiles: string[] = []): string[] {
  const found: string[] = []
  const push = (value: string): void => {
    const cleaned = value.replace(/^[`'"([{]+|[`'")\]},;:.]+$/g, '').trim()
    if (!cleaned) return
    if (!READABLE.test(cleaned)) return
    if (!found.includes(cleaned)) found.push(cleaned)
  }

  // 1) Sahiplik listesi: düz dosyalar doğrudan adaydır; dizinler atlanır.
  for (const entry of ownedFiles) {
    if (entry.endsWith('/')) continue
    if (entry.includes('*')) continue
    push(entry)
  }

  // 2) İstemdeki dosya belirteçleri (ters bölü veya eğik çizgi, uzantılı).
  for (const match of prompt.matchAll(/[\w./\\-]+\.(?:[A-Za-z0-9]{1,5})\b/g)) {
    push(match[0])
  }

  return found.slice(0, MAX_PREFETCH * 2)
}

/** Yolu çalışma alanına sabitler; dışarı çıkıyorsa null. */
export function resolveInside(root: string, candidate: string): string | null {
  try {
    const absolute = isAbsolute(candidate) ? normalize(candidate) : normalize(join(root, candidate))
    const rel = relative(normalize(root), absolute)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    return absolute
  } catch {
    return null
  }
}

export interface PrefetchedFile {
  /** İstemin/çağrının gösterdiği yol (konuşmada bu görünür). */
  path: string
  /** Okunan içerik (kırpılmış). */
  content: string
  /** Gerçekten okundu mu? */
  ok: boolean
  /** Kırpıldı mı? */
  truncated?: boolean
}

/**
 * Aday dosyaları okur.
 *
 * `read` enjekte edilebilir: testler disk kullanmadan doğrulayabilir.
 */
export async function prefetchFiles(options: {
  root: string | null
  candidates: string[]
  maxFiles?: number
  maxTotalChars?: number
  maxFileChars?: number
  parallelism?: number
  read?: (absolutePath: string) => Promise<string>
}): Promise<PrefetchedFile[]> {
  const root = options.root
  if (!root) return []
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? MAX_PREFETCH, MAX_PREFETCH))
  const maxTotal = Math.max(1_000, options.maxTotalChars ?? MAX_PREFETCH_CHARS)
  const maxFile = Math.max(500, options.maxFileChars ?? MAX_SINGLE_FILE_CHARS)
  const parallelism = Math.max(1, options.parallelism ?? performanceProfile().toolParallelism)
  const read = options.read ?? ((path: string) => fs.readFile(path, 'utf8'))

  const unique: Array<{ path: string; absolute: string }> = []
  for (const candidate of options.candidates) {
    if (unique.length >= maxFiles) break
    const absolute = resolveInside(root, candidate)
    if (!absolute) continue
    if (unique.some((entry) => entry.absolute === absolute)) continue
    unique.push({ path: candidate, absolute })
  }
  if (unique.length === 0) return []

  let budget = maxTotal
  const results = await runWithConcurrency(unique, parallelism, async (entry) => {
    try {
      const raw = await read(entry.absolute)
      if (budget <= 0) return { path: entry.path, content: '', ok: false }
      const allowance = Math.min(maxFile, budget)
      budget -= Math.min(raw.length, allowance)
      const truncated = raw.length > allowance
      return {
        path: entry.path,
        content: truncated ? raw.slice(0, allowance) : raw,
        ok: true,
        ...(truncated ? { truncated: true } : {})
      } satisfies PrefetchedFile
    } catch {
      return { path: entry.path, content: '', ok: false } satisfies PrefetchedFile
    }
  })

  return results.filter((entry) => entry.ok)
}

/**
 * Ön okuma sonuçlarını konuşmaya ekler (gerçek bir araç turu gibi).
 *
 * Dönüş: eklenen ileti sayısı. Hiç dosya okunmadıysa konuşma değişmez.
 */
export function appendPrefetch(
  messages: Array<Record<string, unknown>>,
  files: PrefetchedFile[]
): number {
  if (files.length === 0) return 0

  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: files.map((file, index) => ({
      id: `prefetch-${index}`,
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path: file.path }) }
    }))
  })

  for (const [index, file] of files.entries()) {
    messages.push({
      role: 'tool',
      tool_call_id: `prefetch-${index}`,
      content:
        `ÖN OKUMA: ${file.path}\n\n` +
        file.content +
        (file.truncated ? '\n\n[ön okuma sınırına takıldı; gerekirse read_file ile tamamını oku]' : '')
    })
  }
  return files.length + 1
}

/** Ön okuma isteme eklenecek not. */
export function prefetchNote(files: PrefetchedFile[]): string {
  if (files.length === 0) return ''
  const list = files.map((file) => `- ${file.path}`).join('\n')
  return (
    `\n\nÖN OKUMA: Şu dosyaların içeriği zaten bağlamda:\n${list}\n` +
    'Bu dosyaları **tekrar okumaya çalışma**. Doğrudan analize geç; ilk yanıtında ' +
    'bulguları yazmaya başla. Yalnızca listede olmayan ve gerçekten gerekli bir dosyayı oku.'
  )
}
