/**
 * Olay günlüğü döndürmesi (rotation).
 *
 * ## Neden
 *
 * `session-events.jsonl` her olayı sonuna ekler ve hiç küçülmez. Canlı koşuda
 * dört oturum 4514 olay / 1.1 MB üretti. Bu hızla birkaç ay içinde onlarca MB
 * olur; okuma (`readEvents`) her seferinde tüm dosyayı tarar ve `session:sync`
 * yavaşlar.
 *
 * ## Tasarım
 *
 * - Eşik aşıldığında mevcut dosya `session-events.<zaman>.jsonl` olarak
 *   arşivlenir ve boş bir günlükle devam edilir.
 * - En yeni `keep` kadar arşiv tutulur, eskiler silinir.
 * - Döndürme **ekleme yolunda** denenir ama akışı asla durdurmaz: hata
 *   olursa yalnızca loglanır.
 * - `shouldRotate()` saftır (boyut + eşik → karar); test edilebilir.
 *
 * Sınır: döndürme yarış koşuluna açıktır (iki olay aynı anda). Pratikte
 * yalnızca tek bir yazma zinciri (`appendSessionEvent` → `appendFile`) vardır
 * ve döndürme o zincirin içinde değil, periyodik kontrolle yapılır; en kötü
 * durumda birkaç olay eski dosyada kalır — kayıp değil.
 */

import { createLogger } from './logger'

const log = createLogger('sessionEvents')

/** Varsayılan eşik: 8 MB. */
export const ROTATE_BYTES = 8 * 1024 * 1024
/** Tutulacak arşiv sayısı (en yeni önce). */
export const ROTATE_KEEP = 3

/**
 * Döndürme gerekli mi?
 *
 * @param size  Mevcut dosya boyutu (bayt).
 * @param limit Eşik (bayt).
 */
export function shouldRotate(size: number, limit: number = ROTATE_BYTES): boolean {
  if (!Number.isFinite(size) || size < 0) return false
  if (!Number.isFinite(limit) || limit <= 0) return false
  return size >= limit
}

/**
 * Arşiv dosyası adını üretir: `session-events.<ISO>.jsonl`.
 *
 * ISO zaman damgası sıralanabilir olduğu için "en yeni N arşivi tut"
 * mantığı dosya adı sıralamasıyla çalışır. `:` ve `.` Windows'ta dosya
 * adında sorun çıkarabileceği için tireye çevrilir.
 */
export function archiveName(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('Z', '')
  return `session-events.${stamp}.jsonl`
}

/**
 * En yeni `keep` arşivi tutacak şekilde silinecek dosyaları seçer.
 * Saf fonksiyon: yalnızca isim listesi alır, disk erişimi yoktur.
 */
export function archivesToDelete(names: string[], keep: number = ROTATE_KEEP): string[] {
  const archives = names
    .filter((name) => /^session-events\..+\.jsonl$/i.test(name))
    .sort()
  if (archives.length <= keep) return []
  return archives.slice(0, archives.length - keep)
}

/**
 * Günlük dosyasını döndürür.
 *
 * Hata fırlatmaz: döndürme başarısız olsa da olay yazımı devam etmelidir.
 * @returns Arşivlendiyse arşiv adı, değilse `null`.
 */
export async function rotateIfNeeded(options: {
  file: string
  readdir: (dir: string) => Promise<string[]>
  stat: (file: string) => Promise<number>
  rename: (from: string, to: string) => Promise<void>
  unlink: (file: string) => Promise<void>
  dirname: string
  limit?: number
  keep?: number
}): Promise<string | null> {
  try {
    const size = await options.stat(options.file).catch(() => 0)
    if (!shouldRotate(size, options.limit)) return null

    const name = archiveName()
    const target = joinPath(options.dirname, name)
    await options.rename(options.file, target)
    log.info(`Olay günlüğü döndürüldü: ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`)

    const names = await options.readdir(options.dirname).catch(() => [])
    for (const stale of archivesToDelete(names, options.keep)) {
      await options.unlink(joinPath(options.dirname, stale)).catch(() => undefined)
    }
    return name
  } catch (error) {
    log.warn('Olay günlüğü döndürülemedi:', error)
    return null
  }
}

/** Platformdan bağımsız birleştirme (test enjeksiyonu için ayrı). */
function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`
}

/**
 * Gerçek dosya sistemiyle döndürme — üretim yolu.
 * `rotateIfNeeded`'i fs fonksiyonlarıyla sarar.
 */
export async function rotateEventsFile(
  file: string,
  options: { limit?: number; keep?: number } = {}
): Promise<string | null> {
  const { readdir, stat, rename, unlink } = await import('fs/promises')
  return rotateIfNeeded({
    file,
    dirname: dirnameOf(file),
    limit: options.limit,
    keep: options.keep,
    readdir: async (dir) => (await readdir(dir)) as string[],
    stat: async (target) => (await stat(target)).size,
    rename: async (from, to) => rename(from, to),
    unlink: async (target) => unlink(target)
  })
}

/** Basit `dirname` (path modülüne bağımlı olmadan test edilebilir). */
function dirnameOf(file: string): string {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return index <= 0 ? '.' : file.slice(0, index)
}
