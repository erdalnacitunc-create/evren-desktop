import { dirname } from 'path'

/**
 * Kullanıcı mesajından **salt-okunur** erişim kökleri çıkarır (0.4.25).
 *
 * ## Neden
 *
 * 0.4.24 canlı koşusunda (22 Kasım) oturumun çalışma alanı boş bir geçici
 * dizindi, sorgu ise masaüstündeki projeyi hedefliyordu. Ana ajan `run_command`
 * ile okuyabildi; `explore` alt ajanları **hiçbir şey okuyamadı** ve iki ajan
 * 6 dakika boyunca başarısız araç denemesiyle adım yaktı.
 *
 * Çözüm, çalışma alanı kısıtını gevşetmek değil: yalnızca **kullanıcının
 * mesajında açıkça yazdığı** yollar salt-okunur kök olarak eklenir. Model kendi
 * kafasına göre yeni kök ekleyemez; yazma hiçbir koşulda açılmaz.
 *
 * ## Sınırlar
 *
 * - En fazla `MAX_READ_ROOTS` kök (5): mesajda 40 yol geçse de hepsi açılmaz.
 * - Yalnızca **var olan** yollar kabul edilir (`probe`).
 * - Dosya verilirse **üst dizini** kök olur: ajan aynı projedeki komşu
 *   dosyaları da okuyabilsin.
 *
 * Modül saftır; `scripts/read-roots-test.ts` ile doğrulanır.
 */

export const MAX_READ_ROOTS = 5

export type PathKind = 'dir' | 'file' | null

/** Windows mutlak yol: `C:\...` veya `C:/...`. */
const WINDOWS_ABS = /[A-Za-z]:[\\/][^\s"'`<>|*?]+/g
/** POSIX mutlak yol: en az iki parça (`/home/x`, `/usr/lib`). */
const POSIX_ABS = /\/(?:[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)+/g

/** Yolun sonundaki cümle noktalamasını temizler. */
function trimTrailing(value: string): string {
  return value.replace(/[.,;:)\]}»"']+$/u, '').trim()
}

/**
 * Metindeki mutlak yollar. Sıra korunur, tekrarlar atılır.
 *
 * Yalnızca sözdizimsel çıkarım yapar; yolun gerçekten var olup olmadığını
 * `deriveReadRoots` sorar.
 */
export function extractAbsolutePaths(text: string): string[] {
  const value = String(text ?? '')
  const found: string[] = []
  for (const match of value.matchAll(WINDOWS_ABS)) found.push(match[0])
  for (const match of value.matchAll(POSIX_ABS)) found.push(match[0])

  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of found) {
    const cleaned = trimTrailing(raw)
    // Tek harflik ya da yalnızca sürücü kökü (`C:\`) işe yaramaz.
    if (cleaned.length < 4) continue
    if (/^[A-Za-z]:[\\/]?$/.test(cleaned)) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
  }
  return result
}

/**
 * Metinden okuma kökleri üretir.
 *
 * `probe` yolun türünü söyler: `'dir'` | `'file'` | `null` (yok). Testte sahte,
 * üretimde `fs.statSync` tabanlı.
 */
export function deriveReadRoots(
  text: string,
  probe: (path: string) => PathKind,
  options: { maxRoots?: number } = {}
): string[] {
  const limit = Math.max(1, Math.min(MAX_READ_ROOTS, options.maxRoots ?? MAX_READ_ROOTS))
  const roots: string[] = []
  for (const abs of extractAbsolutePaths(text)) {
    const kind = probe(abs)
    if (!kind) continue
    const root = kind === 'file' ? dirname(abs) : abs
    if (root.length < 4) continue
    const key = root.toLowerCase()
    if (roots.some((existing) => existing.toLowerCase() === key)) continue
    roots.push(root)
    if (roots.length >= limit) break
  }
  return roots
}
