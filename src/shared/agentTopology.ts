/**
 * Hibrit ajan topolojisi — tipler, sert sınırlar ve triage kararı.
 *
 * ## Neden bu modül var
 *
 * İki yapı farklı eksenlerde çalışır:
 *  - **Çoklu Evren**: model çeşitliliği (yatay). Aynı soruya farklı modeller
 *    bağımsız cevap verir.
 *  - **Alt ajan**: bağlam izolasyonu (dikey). Keşif ana bağlamı kirletmez.
 *
 * Naif birleştirme (`her alt ajana çoklu evren`) maliyeti çarpar ve çelişen
 * kararlar üretir. Bu yüzden sıralı aşama kullanılır:
 *
 *   keşif (paralel, salt-okunur) → aday üretimi (paralel, salt-okunur)
 *     → sentez (tek hakem) → eylem (tek yazıcı)
 *
 * Tek cümle: **okuma paralel, yazma seri.**
 *
 * Gerekçe ve kaynaklar: `docs/HYBRID-AGENT-ARCHITECTURE.md`
 *
 * Bu modül **saftır**: disk, ağ veya saat erişimi yoktur. Karar fonksiyonu
 * aynı girdiye her zaman aynı planı verir; bu yüzden test edilebilir.
 */

/** Çalıştırma modu. Her mod farklı bir bütçe ve yetki kümesi getirir. */
export type TopologyMode = 'direct' | 'recon' | 'multiverse' | 'hybrid'

/** Kim yazabilir. Hibrit mimarinin en kritik kuralı. */
export type WriteAuthority = 'lead-only' | 'none'

export interface TopologyPlan {
  mode: TopologyMode
  /** Kaç salt-okunur keşif alt ajanı çalışacak. */
  reconSubagents: number
  /** Çoklu Evren'de kaç üye model yarışacak (sentez hariç). */
  memberModels: number
  /** Bu plan için üst sınır model çağrısı (adım başına çağrılar hariç). */
  maxModelCalls: number
  /** Yazma yetkisi. Hibritte daima `lead-only`. */
  writeAuthority: WriteAuthority
  /** Kullanıcıya gösterilecek kısa gerekçe (Türkçe). */
  reason: string
  /** Planı tetikleyen sinyaller (tanılama ve A/B için). */
  signals: string[]
}

// ---------------------------------------------------------------------------
// Sert sınırlar — moddan bağımsız tavanlar
// ---------------------------------------------------------------------------

/** Aynı anda çalışabilecek alt ajan sayısı. */
export const MAX_CONCURRENT_SUBAGENTS = 6

/** Tek istekte toplam kaç alt ajan açılabilir (bütçe). */
export const MAX_SUBAGENTS_PER_REQUEST = 6

/** Çoklu Evren'de üye model sayısı (sentez çağrısı hariç). */
export const MAX_MULTIVERSE_MEMBERS = 3

/** Tek istekte toplam model çağrısı tavanı (adım içi çağrılar dahil değil). */
export const MAX_TOTAL_MODEL_CALLS = 12

/** Alt ajan derinliği: alt ajan alt ajan açamaz. */
export const MAX_SUBAGENT_DEPTH = 1

/** Alt ajan başına adım ve araç çağrısı (mevcut `subagent.ts` ile aynı). */
export const SUBAGENT_MAX_STEPS = 10
export const SUBAGENT_MAX_TOOL_CALLS = 20

/** Alt ajan çıktısı lidere dönerken kırpılır. */
export const SUBAGENT_OUTPUT_MAX_CHARS = 12_000

/** Skill kataloğu (yalnızca ad + açıklama) için token bütçesi. */
export const SKILL_CATALOG_MAX_TOKENS = 6_000

/** Bir ajana enjekte edilecek en fazla skill gövdesi. */
export const SKILLS_INJECTED_PER_AGENT = 3

/** Tek skill gövdesi için token tavanı. */
export const SKILL_BODY_MAX_TOKENS = 4_000

/** Otomatik skill taslağı: oturum ve hafta sınırı. */
export const AUTO_SKILL_DRAFTS_PER_SESSION = 1
export const AUTO_SKILL_DRAFTS_PER_WEEK = 3
/** Aynı iş akışı kaç kez tekrarlanınca taslak önerilir. */
export const AUTO_SKILL_REPEAT_THRESHOLD = 3

/** Görev metni benzerliği bu eşiği aşarsa spawn reddedilir (tekrar iş). */
export const DUPLICATE_TASK_SIMILARITY = 0.7

// ---------------------------------------------------------------------------
// Triage girdisi
// ---------------------------------------------------------------------------

export interface TopologyInput {
  /** Kullanıcının son mesajı. */
  query: string
  /** Çalışma alanı seçili mi? (dosya erişimi var mı) */
  hasWorkspace: boolean
  /** Kullanıcı Çoklu Evren'i açtı mı? Kullanıcı seçimi her zaman kazanır. */
  multiverseRequested: boolean
  /** Bu istek için kalan model çağrısı bütçesi. */
  remainingCallBudget?: number
  /** Önceki turlarda hata/başarısızlık oldu mu? (kök neden analizini teşvik eder) */
  afterFailure?: boolean
  /** Son oturumlarda bu sorguya benzer bir iş kaç kez yapıldı (skill tekrarı). */
  repeatCount?: number
}

// ---------------------------------------------------------------------------
// Sezgisel sinyaller
// ---------------------------------------------------------------------------

/** Genişlik (breadth) göstergeleri: birden çok bağımsız yön. */
const BREADTH_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ve|ayrıca|ile birlikte|hem de)\b/gi, 'bağlaç'],
  [/\b(tüm|bütün|hepsi|hepsini|her biri)\b/gi, 'kapsam'],
  [/\b(karşılaştır|kıyasla|farkları|arasındaki fark|versus|vs)\b/gi, 'karşılaştırma'],
  [/\b(listele|döküm|envanter|tarama|bul|ara)\b/gi, 'envanter'],
  [/\b(nerede|hangi dosya|hangi modül|nasıl çalışıyor)\b/gi, 'keşif']
]

/**
 * Çok soru işareti = birden çok bağımsız alt soru.
 *
 * Eşik 3: iki soru işareti çoğu zaman tek bir tercih sorusudur
 * ("SQLite mı dosya mı? Hangisi daha iyi?") ve bunu keşif saymak yanlış
 * olur — asıl sinyal `karar`dır. Üç ve üzeri gerçekten çok parçalıdır.
 */
function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length
}

/** Karar/risk göstergeleri: çeşitlilik değerli. */
const DECISION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(hangisi|hangisini|tercih|seçmeliyim|daha iyi|önerir misin)\b/gi, 'tercih'],
  [/\b(mimari|tasarım|yaklaşım|strateji|plan)\b/gi, 'mimari'],
  [/\b(neden|kök neden|sebep|hata|bozuk|çalışmıyor)\b/gi, 'kök neden'],
  [/\b(risk|güvenlik|performans|ölçek|maliyet)\b/gi, 'risk'],
  [/\b(refactor|yeniden yaz|migrasyon|geçiş)\b/gi, 'büyük değişiklik']
]

/** Basit/tek adımlık iş göstergeleri. */
const SIMPLE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(tek|sadece|yalnızca)\b/gi, 'daraltılmış'],
  [/\b(düzelt|ekle|sil|yeniden adlandır|formatla|yazdır)\b/gi, 'tek eylem']
]

function countMatches(text: string, patterns: Array<[RegExp, string]>): string[] {
  const hits: string[] = []
  for (const [pattern, label] of patterns) {
    // `g` bayraklı regex'ler `test` ile durum tutar; her seferinde yeniden kur.
    const re = new RegExp(pattern.source, pattern.flags)
    if (re.test(text)) hits.push(label)
  }
  return hits
}

/** Metindeki toplam kelime sayısı (kaba karmaşıklık ölçüsü). */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Metni karşılaştırma için token kümesine çevirir. */
function taskTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  )
}

/**
 * İki görevin düz Jaccard benzerliği (0–1). Yalnızca raporlama içindir;
 * tekrar tespiti `isDuplicateTask` ile yapılır.
 */
export function taskSimilarity(a: string, b: string): number {
  const left = taskTokens(a)
  const right = taskTokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Yeni görev, mevcut görevlerden biriyle gerçekten **aynı** mı?
 *
 * ## Neden düz Jaccard yetmez
 *
 * Modeller görevleri şablonla yazar: "X ile ilgili tüm dosyaları bul, her
 * birinde tanımlı fonksiyonları listele". Yalnızca `X` değişir. Düz Jaccard
 * bu iki **farklı** görevi %70+ benzer görüp ikincisini reddeder — canlı
 * testte ilk 6 alt ajan yerine 1 tanesi çalıştı, çünkü diğerleri "yinelenen"
 * sayıldı.
 *
 * ## Çözüm: IDF ağırlıklı benzerlik
 *
 * Mevcut görevlerde sık geçen token (şablon sözcükleri: "ilgili", "dosyaları",
 * "listele") düşük ağırlık alır; yalnızca bir görevde geçen ayırt edici token
 * ("faturalama", "arama") yüksek ağırlık alır. Böylece şablon ortaklığı
 * benzerliği şişirmez, gerçek tekrar yakalanır.
 */
export function isDuplicateTask(prompt: string, existing: string[]): boolean {
  if (existing.length === 0) return false
  const target = taskTokens(prompt)
  if (target.size === 0) return false

  // Belge frekansı: her token kaç mevcut görevde geçiyor.
  const frequency = new Map<string, number>()
  for (const other of existing) {
    for (const token of taskTokens(other)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1)
    }
  }
  const weight = (token: string): number => 1 / (1 + (frequency.get(token) ?? 0))

  for (const other of existing) {
    const otherTokens = taskTokens(other)
    if (otherTokens.size === 0) continue

    let intersection = 0
    let union = 0
    for (const token of target) {
      const w = weight(token)
      union += w
      if (otherTokens.has(token)) intersection += w
    }
    // `target` içinde olmayan token'ları da birleşime ekle (ağırlıksız
    // sayılmaz: onlar da bu görevde ayırt edici olabilir).
    for (const token of otherTokens) {
      if (target.has(token)) continue
      union += weight(token)
    }
    if (union === 0) continue
    if (intersection / union >= DUPLICATE_TASK_SIMILARITY) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/**
 * Sorguya uygun topolojiyi seçer.
 *
 * Kural sırası (önemli):
 *  1. Kullanıcı Çoklu Evren'i açtıysa `multiverse` veya `hybrid`.
 *  2. Bütçe yoksa `direct`.
 *  3. Basit iş + karar sinyali yok → `direct`.
 *  4. Genişlik var, karar yok → `recon`.
 *  5. Karar var, genişlik yok → `multiverse`.
 *  6. İkisi de varsa → `hybrid`.
 *
 * Sentez çağrısı her zaman bütçeden düşülür, böylece plan asla tavanı aşmaz.
 */
export function planTopology(input: TopologyInput): TopologyPlan {
  const query = input.query ?? ''
  const signals: string[] = []
  const words = wordCount(query)

  const breadth = countMatches(query, BREADTH_PATTERNS)
  if (questionMarkCount(query) >= 3) breadth.push('çok soru')
  const decision = countMatches(query, DECISION_PATTERNS)
  const simple = countMatches(query, SIMPLE_PATTERNS)

  if (breadth.length > 0) signals.push(`genişlik:${breadth.join('+')}`)
  if (decision.length > 0) signals.push(`karar:${decision.join('+')}`)
  if (simple.length > 0) signals.push(`basit:${simple.join('+')}`)
  if (input.afterFailure) signals.push('önceki-hata')
  if (words > 40) signals.push('uzun-sorgu')

  const budget = Number.isFinite(input.remainingCallBudget)
    ? Math.max(0, Math.floor(input.remainingCallBudget as number))
    : MAX_TOTAL_MODEL_CALLS

  // --- 1) Kullanıcı seçimi her zaman kazanır -------------------------------
  if (input.multiverseRequested) {
    const wantsRecon = breadth.length > 0 && input.hasWorkspace
    // Keşif + en az 2 üye + sentez sığmalı; sığmıyorsa keşif düşer.
    const reconSubagents = wantsRecon
      ? Math.max(0, Math.min(2, budget - MAX_MULTIVERSE_MEMBERS - 1))
      : 0
    const memberModels = Math.min(MAX_MULTIVERSE_MEMBERS, budget - 1)
    if (memberModels < 2) {
      return {
        mode: 'direct',
        reconSubagents: 0,
        memberModels: 0,
        maxModelCalls: 1,
        writeAuthority: 'lead-only',
        reason: 'Çoklu Evren istendi ama kalan bütçe en az 2 üyeye yetmiyor.',
        signals: [...signals, 'bütçe-yetersiz']
      }
    }
    return {
      mode: reconSubagents > 0 ? 'hybrid' : 'multiverse',
      reconSubagents,
      memberModels,
      maxModelCalls: reconSubagents + memberModels + 1,
      writeAuthority: 'lead-only',
      reason:
        reconSubagents > 0
          ? `Çoklu Evren açık; keşif ${reconSubagents} alt ajanla paralel, ardından ${memberModels} üye model yarışır.`
          : `Çoklu Evren açık; ${memberModels} üye model bağımsız cevap üretir, tek sentez yapılır.`,
      signals: [...signals, 'kullanıcı-seçimi']
    }
  }

  // --- 2) Bütçe yetersiz ---------------------------------------------------
  // Paralel bir plan en az 2 ajan + 1 sentez = 3 çağrı ister. Bunun altında
  // fan-out matematiksel olarak sığmaz; tek koşuya düşülür.
  if (budget < 3) {
    return {
      mode: 'direct',
      reconSubagents: 0,
      memberModels: 0,
      maxModelCalls: 1,
      writeAuthority: 'lead-only',
      reason: 'Bütçe paralel plana yetmiyor; tek koşuyla cevap verilir.',
      signals: [...signals, 'bütçe-yetersiz']
    }
  }

  // --- 3) Basit iş ---------------------------------------------------------
  const isSimple = simple.length > 0 && decision.length === 0 && breadth.length === 0
  if (isSimple || (words <= 8 && decision.length === 0)) {
    return {
      mode: 'direct',
      reconSubagents: 0,
      memberModels: 0,
      maxModelCalls: 1,
      writeAuthority: 'lead-only',
      reason: 'Sorgu tek adımlık; paralel keşif veya model çeşitliliği gereksiz.',
      signals: [...signals, 'tek-adım']
    }
  }

  // --- 4) Yalnızca genişlik ------------------------------------------------
  if (breadth.length > 0 && decision.length === 0) {
    const reconSubagents = Math.max(
      2,
      Math.min(input.hasWorkspace ? 4 : 2, Math.floor(budget / 2))
    )
    return {
      mode: 'recon',
      reconSubagents,
      memberModels: 0,
      maxModelCalls: reconSubagents + 1,
      writeAuthority: 'lead-only',
      reason: `${reconSubagents} salt-okunur alt ajan paralel keşif yapar; tek model sentezler. Model çeşitliliği gerekmiyor.`,
      signals
    }
  }

  // --- 5) Yalnızca karar ---------------------------------------------------
  if (decision.length > 0 && breadth.length === 0) {
    const memberModels = Math.max(2, Math.min(MAX_MULTIVERSE_MEMBERS, budget - 1))
    return {
      mode: 'multiverse',
      reconSubagents: 0,
      memberModels,
      maxModelCalls: memberModels + 1,
      writeAuthority: 'lead-only',
      reason: `${memberModels} üye model bağımsız yaklaşım önerir; karar tek hakemde verilir.`,
      signals
    }
  }

  // --- 6) Hibrit -----------------------------------------------------------
  const reconSubagents = Math.min(3, Math.max(2, Math.floor((budget - 2) / 2)))
  const memberModels = Math.max(
    2,
    Math.min(MAX_MULTIVERSE_MEMBERS, budget - reconSubagents - 1)
  )
  const calls = reconSubagents + memberModels + 1
  if (calls > budget) {
    // Bütçe yetmiyorsa çoklu evrenden kıs, keşfi koru (keşif daha ucuz).
    return {
      mode: 'recon',
      reconSubagents: Math.min(reconSubagents, Math.max(2, budget - 1)),
      memberModels: 0,
      maxModelCalls: Math.min(reconSubagents, Math.max(2, budget - 1)) + 1,
      writeAuthority: 'lead-only',
      reason: 'Bütçe hibrit için yetmiyor; keşif korunur, model çeşitliliği düşürülür.',
      signals: [...signals, 'bütçe-kısıtı']
    }
  }

  return {
    mode: 'hybrid',
    reconSubagents,
    memberModels,
    maxModelCalls: calls,
    writeAuthority: 'lead-only',
    reason: `${reconSubagents} alt ajanla keşif, ${memberModels} üye modelle bağımsız aday, tek hakem sentezi. Yazma lidere ait.`,
    signals
  }
}

// Küçük yardımcılar: sabitlerin içe aktarımını okunaklı tutar.
/**
 * Planın sert tavanları aşıp aşmadığını doğrular.
 * Üretim kodunda plan uygulanmadan önce çağrılmalıdır.
 */
export function validatePlan(plan: TopologyPlan, budget = MAX_TOTAL_MODEL_CALLS): string[] {
  const problems: string[] = []
  if (plan.reconSubagents > MAX_SUBAGENTS_PER_REQUEST) {
    problems.push(`alt ajan sayısı ${MAX_SUBAGENTS_PER_REQUEST} sınırını aşıyor`)
  }
  if (plan.reconSubagents > MAX_CONCURRENT_SUBAGENTS) {
    problems.push(`eşzamanlı alt ajan ${MAX_CONCURRENT_SUBAGENTS} sınırını aşıyor`)
  }
  if (plan.memberModels > MAX_MULTIVERSE_MEMBERS) {
    problems.push(`üye model sayısı ${MAX_MULTIVERSE_MEMBERS} sınırını aşıyor`)
  }
  if (plan.maxModelCalls > Math.min(MAX_TOTAL_MODEL_CALLS, budget)) {
    problems.push('model çağrısı bütçeyi aşıyor')
  }
  if (plan.writeAuthority !== 'lead-only') {
    problems.push('yazma yetkisi yalnızca liderde olmalı')
  }
  if (plan.reconSubagents < 0 || plan.memberModels < 0) {
    problems.push('negatif ajan sayısı')
  }
  return problems
}

/** Aşama listesi — çalışma zamanı için sıralı yürütme şablonu. */
export function buildStages(plan: TopologyPlan): Array<{
  stage: 'recon' | 'candidates' | 'synthesis' | 'action'
  parallel: boolean
  count: number
  readOnly: boolean
}> {
  const stages: Array<{
    stage: 'recon' | 'candidates' | 'synthesis' | 'action'
    parallel: boolean
    count: number
    readOnly: boolean
  }> = []
  if (plan.reconSubagents > 0) {
    stages.push({
      stage: 'recon',
      parallel: true,
      count: plan.reconSubagents,
      readOnly: true
    })
  }
  if (plan.memberModels > 0) {
    stages.push({
      stage: 'candidates',
      parallel: true,
      count: plan.memberModels,
      readOnly: true
    })
  }
  if (plan.reconSubagents > 0 || plan.memberModels > 0) {
    stages.push({ stage: 'synthesis', parallel: false, count: 1, readOnly: true })
  }
  stages.push({ stage: 'action', parallel: false, count: 1, readOnly: false })
  return stages
}
