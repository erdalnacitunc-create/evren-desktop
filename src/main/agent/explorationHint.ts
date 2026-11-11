/**
 * Keşif ipucu — "listeledin ama okumadın" tespiti.
 *
 * ## Sorun
 *
 * Canlı koşuda gözlendi (0.4.6, "wifi klima klasörü … program yapısını incele"):
 * model 4 `Get-ChildItem -Recurse` çağrısıyla 40+ dosyayı **listeledi**, yapıyı
 * dosya adı ve boyutundan çıkardı ve raporunda 4 kez şunu yazdı:
 *
 *   "Bu dosyaların içeriği okunmadı — doğrulanamadı."
 *
 * Tam o noktada 2-4 paralel `explore` alt ajanı gerçek değer üretirdi: sır
 * taraması, protokol alanları, gerçek bağımlılıklar. Ama modelin düşünme
 * metninde "alt ajan" hiç geçmedi — hiç aklına gelmedi.
 *
 * Sistem istemi kuralı yazmak yetmiyor: model kuralı "dosyaları listele" diye
 * okuyabiliyor. Bu yüzden döngü **durumu** gözleyip tek seferlik hatırlatma
 * yapar.
 *
 * ## Tasarım
 *
 * `progressGuard` ile aynı desen: **hatırlatma, zorlama değil**. Araç
 * engellenmez, yalnızca bir sonraki adıma kısa bir not eklenir ve bu not
 * koşu başına en fazla `maxHints` kez gönderilir.
 *
 * Saf fonksiyon: disk/ağ erişimi yok, test edilebilir
 * (`agent-exploration-hint-test`).
 */

/** Bir araç sonucundan çıkarılan gözlem. */
export interface ToolObservation {
  toolName: string
  ok: boolean
  /** Sonuç metni. */
  content: string
}

export interface ExplorationState {
  /** Listedelen ama içeriği okunmayan dosya yolu sayısı. */
  listedFiles: number
  /** Bu koşuda içeriği okunan dosya sayısı. */
  readFiles: number
  /** Kaç kez listeleme yapıldı. */
  listCalls: number
  /** Kaç kez içerik okundu. */
  readCalls: number
}

/** Dosya yolu gibi görünen satırları sayar. */
const PATH_PATTERN = /(?:[A-Za-z]:\\|\.\/|\/)[^\s"'<>|]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|cpp|h|hpp|c|dart|json|ya?ml|md|sql|sh|ps1|ino)\b/gi

/** İçeriği okuyan araçlar. */
const READ_TOOLS = new Set(['read_file', 'repo_map', 'code_search'])

/** Dosya listeleyen araçlar (içerik döndürmez). */
const LIST_TOOLS = new Set(['list_files', 'glob', 'grep'])

/**
 * Araç sonucunda kaç dosya yolu geçtiğini tahmin eder.
 *
 * `run_command` ile `Get-ChildItem` çıktısı da bu sayıma girer: canlı koşuda
 * listeleme tam olarak böyle yapılmıştı.
 */
export function countPaths(content: string): number {
  const matches = content.match(PATH_PATTERN) ?? []
  // Tekrarları ayıkla (aynı dosya birden çok yerde geçebilir).
  return new Set(matches.map((match) => match.toLowerCase())).size
}

/** Gözlemden keşif durumunu günceller. */
export function updateExploration(
  state: ExplorationState,
  observation: ToolObservation
): ExplorationState {
  if (!observation.ok) return state
  const next: ExplorationState = { ...state }
  const paths = countPaths(observation.content)

  if (READ_TOOLS.has(observation.toolName)) {
    next.readCalls += 1
    // `read_file` tek dosya okur; `code_search`/`repo_map` birden çok.
    next.readFiles += observation.toolName === 'read_file' ? 1 : paths
    return next
  }

  if (LIST_TOOLS.has(observation.toolName)) {
    next.listCalls += 1
    next.listedFiles += paths
    return next
  }

  // Kabuk komutu: listeleme mi okuma mı olduğunu komut metninden anlarız.
  if (observation.toolName === 'run_command') {
    // İçerik okuma (Get-Content, type, cat) → okuma sayılır.
    if (/\b(Get-Content|type|cat|head|tail|more)\b/i.test(observation.content)) {
      next.readCalls += 1
    } else if (paths >= 5) {
      // 5+ dosya yolu döndüren komut fiilen bir listelemedir.
      next.listCalls += 1
      next.listedFiles += paths
    }
  }

  return next
}

export interface ExplorationHintOptions {
  /** Kaç dosya listelenince ipucu verilir. */
  minListedFiles?: number
  /** Okunan dosya oranı bunun altındaysa "okumadın" sayılır. */
  maxReadRatio?: number
}

/**
 * İpucu verilmeli mi?
 *
 * Koşullar (hepsi):
 *  - en az `minListedFiles` (varsayılan 10) dosya listelenmiş
 *  - okunan/listelenen oranı `maxReadRatio` (varsayılan %20) altında
 *  - henüz ipucu verilmemiş (`hintsSent < maxHints`)
 *
 * Oran kontrolü önemli: 40 dosya listeleyip 15'ini okuyan model zaten keşif
 * yapıyordur; ona ipucu vermek gürültü olur.
 */
export function shouldHintExploration(
  state: ExplorationState,
  hintsSent = 0,
  maxHints = 1,
  options: ExplorationHintOptions = {}
): boolean {
  const minListed = Math.max(1, Math.round(options.minListedFiles ?? 10))
  const maxRatio = Math.min(1, Math.max(0, options.maxReadRatio ?? 0.2))
  if (hintsSent >= maxHints) return false
  if (state.listedFiles < minListed) return false
  const ratio = state.listedFiles === 0 ? 1 : state.readFiles / state.listedFiles
  return ratio < maxRatio
}

export const EXPLORATION_HINT = `DURUM: Birçok dosya listeledin ama içeriklerini okumadın.

Dosya adı ve boyutu mimari hakkında yalnızca tahmin verir; sır, protokol alanı,
gerçek bağımlılık ve fonksiyon davranışı **içerikten** okunur.

Görev içerik doğrulaması gerektiriyorsa:
- 2-4 \`explore\` alt ajanını **paralel** başlat (\`spawn_agent\`, background=true)
- her birine farklı bir dosya grubu ver (ör. "src/ altındaki .h dosyalarını oku, gömülü sırları ve protokol sabitlerini çıkar")
- sonuçları \`task_wait\` ile topla, sonra sentezle

Görev yalnızca yapı/dosya sayısı soruyorsa bu ipucunu yok say ve doğrudan yanıtla.`

/** İpucu metnini üretir (tek metin; ileride çoklu seviye eklenebilir). */
export function explorationHintMessage(): string {
  return EXPLORATION_HINT
}

/** Yeni durum oluşturur (test ve döngü için). */
export function emptyExplorationState(): ExplorationState {
  return { listedFiles: 0, readFiles: 0, listCalls: 0, readCalls: 0 }
}
