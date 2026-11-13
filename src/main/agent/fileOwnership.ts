/**
 * Dosya sahipliği — paralel yazmanın çakışmasız yolu.
 *
 * ## Neden worktree değil
 *
 * `docs/WORKTREE-DECISION.md` ölçümleri: `git worktree add` hızlı (493 ms) ama
 * worktree yalnızca **izlenen** dosyaları görür (plc_proje'de 373/16253 = %2,3)
 * ve `.env`, `secrets.h`, `node_modules`, `.dart_tool` **gelmez**. Yani sır
 * taraması görevleri worktree'de çalışmaz, `run_checks` çalışmaz.
 *
 * Worktree'nin çözdüğü sorun tek: iki ajanın aynı dosyaya yazması. Bu sorunu
 * %1 maliyetle çözen daha basit bir yol var: **her dosyanın tek sahibi olsun.**
 *
 * ## Nasıl çalışır
 *
 * 1. Ana ajan `spawn_agent` çağırırken `files` listesi verir: o ajanın
 *    yazabileceği yollar.
 * 2. Çakışan bir yol zaten sahipliyse spawn **reddedilir** ve modele
 *    "şu dosya X ajanında" denir.
 * 3. Sahip olunan yollar ajana **yazma izni** olarak geçirilir; liste dışına
 *    yazma denemesi araç düzeyinde reddedilir.
 *
 * Sonuç: çakışma *tespit edilmez*, **imkânsız olur**. Ajan kendi kopyasında
 * değil, aynı ağaçta çalışır — yani `node_modules`, `secrets.h`, `run_checks`
 * hepsi yerinde kalır.
 *
 * ## Yol desenleri
 *
 * Üç biçim desteklenir:
 *
 * | Desen | Anlamı |
 * |---|---|
 * | `src/a.ts` | tek dosya |
 * | `src/module/` (sondaki `/`) | dizin ağacı |
 * | `src/**\/*.ts` | glob (`*` tek segment, `**` çok segment) |
 *
 * Eşleşme **iki yönlü** kontrol edilir: sahiplik deseni hedefi kapsıyorsa ya
 * da hedef deseni kapsıyorsa çakışma vardır. Aksi hâlde `src/` sahibi ile
 * `src/a.ts` sahibi çakışma görünmezdi.
 *
 * Saf modül: IO yok. Test: `scripts/file-ownership-test.ts`
 */

/** Windows'ta yol karşılaştırması büyük/küçük harfe duyarsızdır. */
const CASE_INSENSITIVE = process.platform === 'win32'

/** Yolu normalleştirir: ters bölü → eğik bölü, baştaki `./` atılır. */
export function normalizePath(input: string): string {
  let value = String(input ?? '')
    .replace(/\\/g, '/')
    .trim()
  // Baştaki ./ ve / temizle
  value = value.replace(/^\.\//, '').replace(/^\/+/, '')
  // Tekrarlanan bölüleri sadeleştir
  value = value.replace(/\/{2,}/g, '/')
  // Sondaki / (dizin işareti) korunur ama çoklu / kaldırılır
  if (value.length > 1 && value.endsWith('/')) {
    value = `${value.replace(/\/+$/, '')}/`
  }
  return CASE_INSENSITIVE ? value.toLowerCase() : value
}

/** Desen mi (glob veya dizin) yoksa düz dosya yolu mu? */
export function isPattern(input: string): boolean {
  const value = normalizePath(input)
  return value.endsWith('/') || value.includes('*') || value.includes('?')
}

/**
 * Glob desenini regex'e çevirir.
 *
 * `**` her şeyi, `*` tek segmenti, `?` tek karakteri eşler.
 */
function patternToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern)
  let out = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        // `**/` veya `**`
        if (normalized[index + 2] === '/') {
          out += '(?:.*/)?'
          index += 2
        } else {
          out += '.*'
          index += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`^${out}$`)
}

/**
 * İki yol/desen çakışır mı?
 *
 * "Çakışma", ikisinin **aynı dosyaya** yazabileceği anlamına gelir.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a)
  const right = normalizePath(b)
  if (left === right) return true

  const leftPattern = isPattern(left)
  const rightPattern = isPattern(right)

  // Dizin deseni: prefix eşleşmesi (`src/` ile `src/a.ts`)
  if (leftPattern && left.endsWith('/')) {
    const prefix = left.slice(0, -1)
    if (right === prefix || right.startsWith(`${prefix}/`)) return true
  }
  if (rightPattern && right.endsWith('/')) {
    const prefix = right.slice(0, -1)
    if (left === prefix || left.startsWith(`${prefix}/`)) return true
  }

  // Glob: hedefi desenle dene
  if (leftPattern && !left.endsWith('/') && patternToRegex(left).test(right)) return true
  if (rightPattern && !right.endsWith('/') && patternToRegex(right).test(left)) return true

  // İki desen: statik önekleri kesişmiyorsa çakışmazlar.
  if (leftPattern && rightPattern) {
    return patternPrefixesIntersect(left, right)
  }

  return false
}

/**
 * Desenin ilk joker karakterden önceki sabit kısmı.
 *
 * `src/auth/` → `src/auth/` · `src/**\/*.ts` → `src/` · `*.ts` → ``
 */
export function staticPrefix(pattern: string): string {
  const normalized = normalizePath(pattern)
  const wildcard = normalized.search(/[*?]/)
  if (wildcard === -1) return normalized
  const head = normalized.slice(0, wildcard)
  // Jokerin hemen öncesindeki tamamlanmamış segmenti at.
  const slash = head.lastIndexOf('/')
  return slash === -1 ? '' : head.slice(0, slash + 1)
}

/**
 * İki desenin çakışıp çakışmadığını statik öneklerle anlar.
 *
 * Neden gerekli: "iki desen varsa çakışır" kuralı çok temkinliydi ve
 * `src/auth/` ile `src/billing/` gibi **ayrık** dizinleri çakıştırıyordu.
 * Canlı testte bu, meşru paralel işi reddediyordu.
 *
 * Kural: biri diğerinin öneğiyse (ya da öneklerden biri boşsa) çakışma
 * *olabilir* → temkinli davranıp çakışma say. Önekler ayrıksa kesinlikle
 * çakışmaz.
 */
function patternPrefixesIntersect(left: string, right: string): boolean {
  const a = staticPrefix(left)
  const b = staticPrefix(right)
  // Kök seviyede joker: her şeyi kapsayabilir.
  if (a === '' || b === '') return true
  return a.startsWith(b) || b.startsWith(a)
}

/** İki yol listesinden çakışan çiftleri döndürür. */
export function findOverlaps(
  a: string[],
  b: string[]
): Array<{ a: string; b: string }> {
  const hits: Array<{ a: string; b: string }> = []
  for (const left of a) {
    for (const right of b) {
      if (pathsOverlap(left, right)) hits.push({ a: left, b: right })
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// Sahiplik tablosu
// ---------------------------------------------------------------------------

export interface OwnershipClaim {
  /** Ajan/görev kimliği. */
  id: string
  /** Ajan türü (raporlama için). */
  agentType: string
  /** Sahiplenilen yollar (dosya, dizin veya glob). */
  paths: string[]
  claimedAt: number
}

export interface OwnershipConflict {
  path: string
  ownerId: string
  ownerType: string
  ownerPaths: string[]
}

export interface OwnershipTable {
  /**
   * Yolları sahiplenir. Çakışma varsa **hiçbir şey yazmaz** ve çakışmaları
   * döndürür (atomik).
   */
  claim: (input: {
    id: string
    agentType: string
    paths: string[]
  }) => { ok: true } | { ok: false; conflicts: OwnershipConflict[] }
  /** Bir ajanın sahipliğini bırakır. */
  release: (id: string) => void
  /** Verilen yolları kim sahipleniyor? */
  ownersOf: (paths: string[]) => OwnershipConflict[]
  /** Etkin sahiplikler (tanılama). */
  snapshot: () => OwnershipClaim[]
  /** Belirli bir ajanın sahiplendiği yollar. */
  pathsOf: (id: string) => string[]
  /** Test için. */
  reset: () => void
}

export function createOwnershipTable(): OwnershipTable {
  const claims = new Map<string, OwnershipClaim>()

  const ownersOf = (paths: string[]): OwnershipConflict[] => {
    const conflicts: OwnershipConflict[] = []
    for (const claim of claims.values()) {
      for (const path of paths) {
        for (const owned of claim.paths) {
          if (pathsOverlap(path, owned)) {
            conflicts.push({
              path,
              ownerId: claim.id,
              ownerType: claim.agentType,
              ownerPaths: claim.paths
            })
            break
          }
        }
      }
    }
    return conflicts
  }

  const claim: OwnershipTable['claim'] = (input) => {
    const paths = input.paths.map(normalizePath).filter(Boolean)
    if (paths.length === 0) return { ok: true }

    const conflicts = ownersOf(paths)
    if (conflicts.length > 0) return { ok: false, conflicts }

    claims.set(input.id, {
      id: input.id,
      agentType: input.agentType,
      paths,
      claimedAt: Date.now()
    })
    return { ok: true }
  }

  return {
    claim,
    release: (id) => {
      claims.delete(id)
    },
    ownersOf,
    snapshot: () => [...claims.values()],
    pathsOf: (id) => claims.get(id)?.paths ?? [],
    reset: () => claims.clear()
  }
}

// ---------------------------------------------------------------------------
// Yazma izni
// ---------------------------------------------------------------------------

/**
 * Bir yol, izin listesine uyuyor mu?
 *
 * Boş liste = kısıt yok (salt-okunur ajanlar zaten yazamaz; tek `general`
 * ajanı da kısıtlanmak zorunda değil). Liste doluysa **yalnızca** eşleşen
 * yollar yazılabilir.
 */
export function isWriteAllowed(path: string, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true
  return allowed.some((pattern) => pathsOverlap(path, pattern))
}

/**
 * Modele dönen çakışma mesajı.
 *
 * Modele "yeniden dene" değil, "başka dosya seç" demek istiyoruz: aynı dosyayı
 * tekrar istemek aynı sonucu verir.
 */
export function conflictMessage(conflicts: OwnershipConflict[]): string {
  const lines = conflicts.slice(0, 6).map(
    (conflict) =>
      `- ${conflict.path} → zaten ${conflict.ownerType} ajanında (${conflict.ownerId.slice(0, 12)}): ` +
      conflict.ownerPaths.slice(0, 3).join(', ')
  )
  return (
    'Dosya sahipliği çakışması. Bu dosyalar başka bir alt ajana atanmış:\n' +
    lines.join('\n') +
    '\n\nAynı dosyayı iki ajana verme. Ya bu ajanın dosya listesini daralt, ' +
    'ya diğer ajanın bitmesini bekle (task_wait), ya da bu dosyayı kendin düzenle.'
  )
}

/** Yazma engeli mesajı (araç düzeyinde). */
export function writeBlockedMessage(path: string, allowed: string[]): string {
  return (
    `Bu dosya sana atanmadı: ${path}\n` +
    `Yazma iznin yalnızca şu yollar: ${allowed.join(', ')}\n` +
    'Liste dışındaki dosyaları düzenlemek dosya sahipliği kuralını ihlal eder. ' +
    'Gerekliyse ana ajana "şu dosya da bana atansın" diye bildir; kendin genişletme.'
  )
}
