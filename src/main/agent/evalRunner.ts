/**
 * Eval koşucusu — OpenAI Evals paterni, EVREN'e uyarlanmış.
 *
 * ## Neden ayrı katman
 *
 * Mevcut 74 paket **deterministik** testtir: "şu girdi → şu kod yolu".
 * Ölçmedikleri şey ajanın **çıktı kalitesi**: rapor doğru mu, kanıta dayanıyor
 * mu, uydurma var mı, araçları verimli mi kullandı.
 *
 * OpenAI Evals (19.8k ★) bu boşluğu iki tür değerlendirmeyle kapatıyor:
 * - **Basic eval**: çıktıyı kesin kurallarla denetler (regex, uzunluk, alan).
 * - **Model-graded eval**: bir LLM hakem rubriğe göre 0-1 puan verir.
 *
 * Bu modül ikisini de destekler. LLM hakem çağrısı dışarıdan enjekte edilir:
 * koşucu saf kalır, test edilebilir, ağ gerektirmez.
 *
 * ## Rubrik (Anthropic research yazısından uyarlama)
 *
 * | Ölçüt | Ne sorar |
 * |---|---|
 * | doğruluk | İddialar araç çıktısıyla destekleniyor mu? |
 * | kanıt | dosya:satır / kaynak referansı var mı? |
 * | tamlık | İstenen tüm boyutlar ele alındı mı? |
 * | dürüstlük | Doğrulanamayanlar açıkça işaretli mi? |
 * | verimlilik | Gereksiz araç çağrısı / tekrar var mı? |
 *
 * Her ölçüt 0-1; toplam ağırlıklı ortalama. Geçme eşiği varsayılan 0.7.
 */

export type EvalCriterion = 'accuracy' | 'evidence' | 'completeness' | 'honesty' | 'efficiency'

export const CRITERIA: EvalCriterion[] = [
  'accuracy',
  'evidence',
  'completeness',
  'honesty',
  'efficiency'
]

/** Ağırlıklar: doğruluk ve dürüstlük en kritik. */
export const CRITERIA_WEIGHTS: Record<EvalCriterion, number> = {
  accuracy: 0.3,
  evidence: 0.2,
  completeness: 0.2,
  honesty: 0.2,
  efficiency: 0.1
}

/** Kural tabanlı denetim (basic eval). */
export interface BasicCheck {
  /** Kısa etiket. */
  label: string
  /** Çıktı metni. */
  test: (output: string) => boolean
  /** Test başarısız olursa ağırlığı (0 = bilgi amaçlı). */
  weight?: number
}

/** Tek bir eval senaryosu. */
export interface EvalCase {
  id: string
  /** İnsan okur açıklama. */
  title: string
  /** Ajana verilecek istem. */
  prompt: string
  /** Çalışma alanı (null = workspace kapalı, ör. web araştırması). */
  workspace: string | null
  /** Kural tabanlı denetimler. */
  checks: BasicCheck[]
  /** LLM hakem kullanılsın mı. */
  judge?: boolean
  /** Bu senaryo için geçme eşiği (varsayılan 0.7). */
  passThreshold?: number
}

export interface BasicResult {
  label: string
  passed: boolean
  weight: number
}

export interface JudgeScore {
  criterion: EvalCriterion
  score: number
  reason?: string
}

export interface EvalRunResult {
  id: string
  title: string
  /** Ajanın ürettiği metin. */
  output: string
  /** Kural tabanlı sonuçlar. */
  basic: BasicResult[]
  /** Hakem puanları (varsa). */
  judge?: JudgeScore[]
  /** Kural tabanlı ağırlıklı skor (0-1). */
  basicScore: number
  /** Hakem ağırlıklı skor (0-1). */
  judgeScore?: number
  /** Birleşik skor: ikisi varsa ortalama. */
  score: number
  passed: boolean
  error?: string
}

/** Metni karşılaştırma için sadeleştirir (Türkçe büyük/küçük harf dahil). */
export function normalizeText(value: string): string {
  return String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Kural tabanlı skoru hesaplar; ağırlıklar toplamı 0 ise 1 döner. */
export function scoreBasic(results: BasicResult[]): number {
  const total = results.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return 1
  const earned = results.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0)
  return Math.round((earned / total) * 1000) / 1000
}

/** Hakem puanlarını ağırlıklı ortalamaya çevirir. */
export function scoreJudge(scores: JudgeScore[]): number {
  if (scores.length === 0) return 0
  let weightSum = 0
  let valueSum = 0
  for (const item of scores) {
    const weight = CRITERIA_WEIGHTS[item.criterion] ?? 0.1
    // 0-1 aralığına sıkıştır: hakem 0-10 verirse de doğru çalışsın.
    const value = item.score > 1 ? item.score / 10 : item.score
    const clamped = Math.max(0, Math.min(1, value))
    weightSum += weight
    valueSum += clamped * weight
  }
  if (weightSum <= 0) return 0
  return Math.round((valueSum / weightSum) * 1000) / 1000
}

/**
 * Hakem istemini üretir (OpenAI model-graded eval deseni).
 *
 * Modelden **yalnızca JSON** istenir; serbest metin ayrıştırma kırılgandır.
 */
export function buildJudgePrompt(input: {
  title: string
  prompt: string
  output: string
  evidence?: string
}): string {
  return [
    'Sen bir değerlendirme hakemisin. Aşağıdaki ajan çıktısını rubriğe göre puanla.',
    '',
    `## Görev\n${input.title}\n\n${input.prompt}`,
    '',
    `## Ajan çıktısı\n${input.output.slice(0, 12_000)}`,
    input.evidence ? `\n## Araç kanıtı (özet)\n${input.evidence.slice(0, 6_000)}` : '',
    '',
    '## Rubrik (her biri 0.0-1.0)',
    '- accuracy: İddialar kanıtla destekleniyor mu? Uydurma var mı?',
    '- evidence: dosya:satır / kaynak referansı var mı?',
    '- completeness: İstenen boyutların tümü ele alındı mı?',
    '- honesty: Doğrulanamayan noktalar açıkça işaretli mi?',
    '- efficiency: Gereksiz araç çağrısı, tekrar veya dolgu var mı?',
    '',
    'Yalnızca şu JSON şemasında yanıt ver:',
    '{"scores":[{"criterion":"accuracy","score":0.0,"reason":"kısa"},...]}',
    'Beş ölçütün hepsi bulunmalı. **reason en fazla 10 kelime** olsun.',
    'Açıklama ekleme, JSON dışında hiçbir şey yazma.'
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Hakem yanıtını ayrıştırır.
 *
 * ## Dayanıklılık (0.4.23)
 *
 * 0.4.22 eval koşusunda üç senaryonun üçünde de hakem boş döndü. Günlükteki
 * yanıt:
 *
 *   `{"scores":[{"criterion":"accuracy","score":0.8,"reason":"D`
 *
 * Yani model **token sınırında kesildi**; `JSON.parse` başarısız oldu ve tüm
 * ölçüm kayboldu. Kesilen bir yanıttan **kısmi puan kurtarmak** gerekir:
 * tamamlanmış `criterion/score` çiftleri kullanılabilir.
 *
 * Bu yüzden iki aşamalı: önce tam JSON, olmazsa regex ile kurtarma.
 */
export function parseJudgeResponse(raw: string): JudgeScore[] {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  // 1) Tam JSON.
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        scores?: Array<{ criterion?: string; score?: unknown; reason?: string }>
      }
      const list = Array.isArray(parsed.scores) ? parsed.scores : []
      const out = coerceScores(list)
      if (out.length > 0) return out
    } catch {
      // Kesik JSON: aşağıdaki kurtarmaya düş.
    }
  }

  // 2) Kesik/bozuk JSON kurtarma: tamamlanmış çiftleri çek.
  const recovered: Array<{ criterion?: string; score?: unknown; reason?: string }> = []
  const pairPattern =
    /"criterion"\s*:\s*"([a-z]+)"\s*,\s*"score"\s*:\s*("?[0-9.]+"?)/gi
  for (const match of text.matchAll(pairPattern)) {
    recovered.push({ criterion: match[1], score: match[2].replace(/"/g, '') })
  }
  return coerceScores(recovered)
}

/** Ham çiftleri doğrulanmış `JudgeScore` listesine çevirir. */
function coerceScores(
  list: Array<{ criterion?: string; score?: unknown; reason?: string }>
): JudgeScore[] {
  const out: JudgeScore[] = []
  const seen = new Set<EvalCriterion>()
  for (const item of list) {
    const criterion = String(item.criterion ?? '').toLowerCase() as EvalCriterion
    if (!CRITERIA.includes(criterion)) continue
    if (seen.has(criterion)) continue
    const score = typeof item.score === 'number' ? item.score : Number(item.score)
    if (!Number.isFinite(score)) continue
    seen.add(criterion)
    out.push({ criterion, score, reason: item.reason })
  }
  return out
}

/**
 * Bir eval sonucunu birleştirir.
 *
 * Kural tabanlı testler **kesin**; hakem **görüş**. İkisi de varsa ortalama
 * alınır — hakem tek başına karar vermez (OpenAI de böyle öneriyor).
 */
export function combineResult(input: {
  id: string
  title: string
  output: string
  basic: BasicResult[]
  judge?: JudgeScore[]
  passThreshold?: number
  error?: string
}): EvalRunResult {
  const basicScore = scoreBasic(input.basic)
  const judgeScore = input.judge && input.judge.length > 0 ? scoreJudge(input.judge) : undefined
  const score =
    judgeScore === undefined
      ? basicScore
      : Math.round(((basicScore + judgeScore) / 2) * 1000) / 1000
  const threshold = input.passThreshold ?? 0.7
  return {
    id: input.id,
    title: input.title,
    output: input.output,
    basic: input.basic,
    judge: input.judge,
    basicScore,
    judgeScore,
    score,
    passed: !input.error && score >= threshold,
    error: input.error
  }
}

/** Toplu özet: kaç senaryo geçti, ortalama skor. */
export function summarizeEvals(results: EvalRunResult[]): {
  total: number
  passed: number
  averageScore: number
  failedIds: string[]
  weakestCriterion?: EvalCriterion
} {
  const total = results.length
  const passed = results.filter((result) => result.passed).length
  const averageScore =
    total === 0
      ? 0
      : Math.round((results.reduce((sum, r) => sum + r.score, 0) / total) * 1000) / 1000

  // En zayıf ölçüt: tüm hakem puanlarının ölçüt bazlı ortalaması.
  const perCriterion = new Map<EvalCriterion, { sum: number; count: number }>()
  for (const result of results) {
    for (const item of result.judge ?? []) {
      const entry = perCriterion.get(item.criterion) ?? { sum: 0, count: 0 }
      entry.sum += item.score > 1 ? item.score / 10 : item.score
      entry.count += 1
      perCriterion.set(item.criterion, entry)
    }
  }
  let weakest: EvalCriterion | undefined
  let weakestAvg = Infinity
  for (const [criterion, entry] of perCriterion) {
    if (entry.count === 0) continue
    const avg = entry.sum / entry.count
    if (avg < weakestAvg) {
      weakestAvg = avg
      weakest = criterion
    }
  }

  return {
    total,
    passed,
    averageScore,
    failedIds: results.filter((result) => !result.passed).map((result) => result.id),
    ...(weakest ? { weakestCriterion: weakest } : {})
  }
}
