/**
 * Skill kataloğu ve yönlendirici.
 *
 * ## Sorun
 *
 * `loadEnabledSkills()` her skill'in **tam gövdesini** okuyor ve sistem
 * istemine tüm skill'lerin ad + açıklamasını yazıyordu. İki risk:
 *
 * 1. **Katalog şişmesi** — 40 skill × ~120 karakter açıklama = 4 800 karakter,
 *    üstüne `skill` aracının açıklaması aynı adları bir kez daha yazıyordu.
 *    Claude Code bile alt ajan açıklamaları 15 000 token'ı aşınca uyarı veriyor.
 * 2. **Alakasız gürültü** — bir donanım sorusunda 40 skill'in tamamını görmek
 *    modelin dikkatini dağıtıyor.
 *
 * ## Çözüm
 *
 * - **Katalog** (her zaman bağlamda): yalnızca ad + kısa açıklama, bütçeyle
 *   sınırlı (`SKILL_CATALOG_MAX_TOKENS`).
 * - **Gövde** (istek üzerine): `skill` aracı çağrılınca yüklenir.
 * - **Yönlendirici**: görev metnine göre en uygun `SKILLS_INJECTED_PER_AGENT`
 *   skill işaretlenir; gövde yine de otomatik yüklenmez, model karar verir.
 *
 * Saf fonksiyonlar: IO yok, test edilebilir (`agent-skill-catalog-test`).
 */

import {
  SKILLS_INJECTED_PER_AGENT,
  SKILL_CATALOG_MAX_TOKENS,
  SKILL_BODY_MAX_TOKENS
} from '../../shared/agentTopology'

/** Skill'in katalog için gereken alanları (tam gövde gerekmez). */
export interface SkillLike {
  id: string
  name: string
  description?: string
  /** İsteğe bağlı: "ne zaman kullanılır" satırı. */
  whenToUse?: string
  content?: string
}

/** Token tahmini: ortalama 4 karakter/token (İngilizce-Türkçe karışımı). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface CatalogResult {
  /** Sistem istemine eklenecek metin (boş olabilir). */
  text: string
  /** Kataloğa sığan skill sayısı. */
  included: number
  /** Bütçe nedeniyle dışarıda kalan sayı. */
  omitted: number
  /** Tahmini token. */
  tokens: number
}

function skillLine(skill: SkillLike, marker = ''): string {
  const description = (skill.description ?? '').trim()
  const when = (skill.whenToUse ?? '').trim()
  // Tek satır: ad [id]: açıklama — ne zaman (varsa)
  const detail = [description, when ? `Ne zaman: ${when}` : ''].filter(Boolean).join(' · ')
  return `- ${skill.name} [${skill.id}]${marker}: ${detail}`
}

/**
 * Katalog metnini bütçeye sığacak şekilde üretir.
 *
 * Sıra korunur (çağıran alakalı olanları başa alabilir). Sığmayanlar
 * sessizce atılmaz: sayısı `omitted` ile döner ve metne not eklenir, böylece
 * model "katalog eksik" olduğunu bilir.
 */
export function buildSkillCatalog(
  skills: SkillLike[],
  options: {
    maxTokens?: number
    /** Öne çıkarılacak (yönlendiricinin seçtiği) skill kimlikleri. */
    highlighted?: string[]
  } = {}
): CatalogResult {
  const maxTokens = Math.max(0, Math.round(options.maxTokens ?? SKILL_CATALOG_MAX_TOKENS))
  if (skills.length === 0) {
    return { text: '', included: 0, omitted: 0, tokens: 0 }
  }

  const highlighted = new Set(options.highlighted ?? [])
  const header = 'Kullanılabilir beceriler'
  const footer = 'Bir becerinin talimatlarını yüklemek için `skill` aracını kullan.'

  const lines: string[] = []
  let tokens = estimateTokens(header) + estimateTokens(footer)
  let included = 0
  let omitted = 0

  for (const skill of skills) {
    const marker = highlighted.has(skill.id) ? ' (bu göreve uygun)' : ''
    const line = skillLine(skill, marker)
    const cost = estimateTokens(line)
    if (tokens + cost > maxTokens) {
      omitted += 1
      continue
    }
    lines.push(line)
    tokens += cost
    included += 1
  }

  if (included === 0) {
    return {
      text: '',
      included: 0,
      omitted: skills.length,
      tokens: 0
    }
  }

  const omittedNote =
    omitted > 0
      ? `\n(${omitted} beceri katalog bütçesi nedeniyle listelenmedi; gerekiyorsa adıyla sor.)`
      : ''
  const text = `\n\n${header}:\n${lines.join('\n')}${omittedNote}\n${footer}`
  return { text, included, omitted, tokens }
}

// ---------------------------------------------------------------------------
// Yönlendirici
// ---------------------------------------------------------------------------

/** Türkçe karakterleri sadeleştirip küçük harfe indirir. */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ')
}

/**
 * Türkçe/İngilizce anlamsız kısa sözcükler.
 *
 * Neden gerekli: `usb`, `git`, `ipc`, `pdf` gibi **kısa ama kritik** terimler
 * uzunluk filtresine takılırsa yönlendirici hiçbir skill seçemez (canlı testte
 * "usb aygıtlarını incele" sorgusu 0 sonuç döndürdü). Bu yüzden eşik 2
 * karaktere indirildi ve yalnızca gerçek dolgu sözcükleri elenir.
 */
const STOPWORDS = new Set([
  've', 'ile', 'bir', 'bu', 'su', 'da', 'de', 'ki', 'mi', 'mu', 'icin', 'olan',
  'olarak', 'gibi', 'daha', 'cok', 'az', 'ne', 'nasil', 'hangi', 'the', 'and',
  'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'you', 'your'
])

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

/** Basit Türkçe gövde kesme (tam morfoloji gerekmiyor). */
function stem(token: string): string {
  for (const suffix of ['lari', 'leri', 'lar', 'ler', 'ini', 'unu', 'nda', 'nde', 'dan', 'den', 'dir', 'dur', 'si', 'su', 'i', 'u']) {
    if (token.length > suffix.length + 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length)
    }
  }
  return token
}

export interface SkillScore {
  id: string
  score: number
}

/**
 * Görev metnine göre skill'leri puanlar.
 *
 * Puanlama: ad eşleşmesi > açıklama eşleşmesi > `whenToUse` eşleşmesi.
 * Ad daha ağır çünkü kullanıcı genelde konuyu adıyla söyler.
 */
export function scoreSkills(skills: SkillLike[], query: string): SkillScore[] {
  const queryTokens = new Set(tokenize(query).map(stem))
  if (queryTokens.size === 0) {
    return skills.map((skill) => ({ id: skill.id, score: 0 }))
  }

  const overlap = (text: string, weight: number): number => {
    const tokens = new Set(tokenize(text).map(stem))
    let hits = 0
    for (const token of tokens) if (queryTokens.has(token)) hits += 1
    return hits * weight
  }

  return skills
    .map((skill) => {
      const score =
        overlap(skill.name, 3) +
        overlap(skill.description ?? '', 1.5) +
        overlap(skill.whenToUse ?? '', 1)
      return { id: skill.id, score }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * En alakalı skill'leri döndürür.
 *
 * Eşiğin altındaki skill'ler **seçilmez**: alakasız bir skill'i "uygun" diye
 * işaretlemek modeli yanlış yola sokar. Hiçbiri eşiği geçmezse boş dizi.
 */
export function routeSkills(
  skills: SkillLike[],
  query: string,
  limit = SKILLS_INJECTED_PER_AGENT,
  minScore = 2
): SkillLike[] {
  if (skills.length === 0) return []
  const scored = scoreSkills(skills, query)
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  return scored
    .filter((entry) => entry.score >= minScore)
    .slice(0, Math.max(0, limit))
    .map((entry) => byId.get(entry.id))
    .filter((skill): skill is SkillLike => Boolean(skill))
}

/**
 * Yönlendirme ipucu: katalogda işaretlemeye ek olarak kısa bir yönlendirme.
 * Gövde yüklemez; yalnızca dikkat çeker.
 */
export function buildSkillHint(routed: SkillLike[]): string {
  if (routed.length === 0) return ''
  const names = routed.map((skill) => `${skill.name} [${skill.id}]`).join(', ')
  return `\n\nBu göreve en uygun beceri(ler): ${names}. Gerekliyse \`skill\` aracıyla yükle.`
}

/**
 * Skill gövdesini bütçeye sığdırır.
 *
 * Gövde çok uzunsa kesilir ve modele kesildiği söylenir; sessiz kesme,
 * modelin yarım talimatla iş yapmasına yol açar.
 */
export function clampSkillBody(content: string, maxTokens = SKILL_BODY_MAX_TOKENS): string {
  const limit = Math.max(200, Math.round(maxTokens * 4))
  if (content.length <= limit) return content
  const cut = content.slice(0, limit)
  return (
    `${cut}\n\n---\n[Beceri gövdesi ${Math.round(limit / 4)} token'da kesildi. ` +
    'Eksik bölüm için becerinin kaynak dosyasını oku.]'
  )
}
