/**
 * Alt ajan fan-out planlayıcısı — kaç ajan, kaç eşzamanlı, hangi aralıkla.
 *
 * ## Neden gerekli
 *
 * 0.4.8 canlı koşusunda model tek seferde **4 alt ajan** başlattı. Sonuç:
 *
 *  - Ana ajan + 4 ajan = anlık **5× istek artışı** → sağlayıcı "slow_down"
 *    (ramp-rate limit) döndürdü → **11 retry**, koşu 13 dakikaya çıktı.
 *  - Her ajana 3 GB'lık dizinler (`master\`, `mobil\` = build artefaktları)
 *    verildi; ajanlar adım bütçesini `node_modules`/`build` içinde yaktı ve
 *    "kısmi" rapor döndürdü.
 *
 * Yani sorun "paralellik" değil, **kontrolsüz paralellik** ve **kapsam
 * disiplini**ydi.
 *
 * ## Önerilen patern: kademeli fan-out (staggered fan-out)
 *
 * Kullanıcı önerisi "alt ajanları tek tek başlat" idi. Tek tek (tam seri)
 * yanlış olur: 4 ajan × 3 dk = 12 dk; paralelliğin tüm faydası kaybolur
 * (Anthropic: paralelleştirme karmaşık sorgularda süreyi %90 kısaltıyor).
 *
 * Doğrusu ikisinin arası:
 *
 *  - **Sayı kapsama göre** (1–4): 15 dosyalık iş için 4 ajan israftır.
 *  - **Eşzamanlılık sınırlı** (en fazla 2): aynı anda 2'den fazlası ramp-rate
 *    limitini tetikliyor.
 *  - **Kademeli başlatma** (stagger): ajanlar arasında kısa gecikme; istek
 *    grafiği ani sıçrama yapmaz.
 *
 * Sonuç: 4 ajan gerekiyorsa 2 dalga hâlinde çalışır (2+2). Süre paralel
 * çalışmaya yakın kalır, retry fırtınası biter.
 *
 * OpenAI rate-limit rehberi de aynısını söylüyor: *"reduce your request rate,
 * and then increase it gradually"* — ani artış `slow_down` üretir.
 *
 * Saf fonksiyon; test: `scripts/agent-fanout-test.ts`
 */

import { MAX_CONCURRENT_SUBAGENTS, MAX_SUBAGENTS_PER_REQUEST } from './agentTopology'

/** Kapsam sinyalleri — ana ajan bunları ölçer. */
export interface ScopeSignals {
  /** Kapsamdaki dosya sayısı (build artefaktları hariç). */
  fileCount?: number
  /** Toplam bayt (build artefaktları hariç). */
  totalBytes?: number
  /** Ayrı dizin/katman sayısı. */
  directoryCount?: number
  /** Sorgunun bilişsel yükü. */
  complexity?: 'simple' | 'moderate' | 'complex'
  /** Kapsamda build artefaktı (node_modules, build, .pio…) var mı? */
  hasBuildArtifacts?: boolean
}

export interface FanoutPlan {
  /** Kaç alt ajan başlatılmalı (1–4). */
  count: number
  /** Aynı anda kaç tanesi koşabilir. */
  concurrency: number
  /** İki ajan başlatma arası beklenecek süre (ms). */
  staggerMs: number
  /** Kapsam brifinginde dışlanacak dizinler. */
  excludedDirs: string[]
  /** Kararın kısa gerekçesi (log ve UI için). */
  reason: string
}

/**
 * Kapsam dışı bırakılacak dizinler.
 *
 * Canlı koşuda `master\` ve `mobil\` 3 GB'tı; ajanlar bu artefaktlarda adım
 * bütçesini tüketti. Bu dizinler mimari hakkında bilgi taşımaz.
 */
export const DEFAULT_EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'build',
  'dist',
  'out',
  '.dart_tool',
  '.pio',
  '.gradle',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  'coverage',
  '.cache',
  'obj',
  'bin'
]

/** Eşzamanlılık tavanı: ramp-rate limitini tetiklememek için 2. */
export const MAX_FANOUT_CONCURRENCY = 2

/** İki ajan başlatma arası varsayılan gecikme. */
export const DEFAULT_STAGGER_MS = 2000

/**
 * Kapsama göre fan-out planı üretir.
 *
 * Eşikler Anthropic'in araştırma sisteminden uyarlanmıştır: basit bilgi
 * toplama 1 ajan, karşılaştırma 2–4 ajan, kapsamlı tarama 4+ ajan. Ancak üst
 * sınır 4: masaüstü istemcisinde 4'ün üzeri sağlayıcı limitine takılıyor.
 */
export function planFanout(signals: ScopeSignals = {}): FanoutPlan {
  const files = Math.max(0, Math.round(signals.fileCount ?? 0))
  const dirs = Math.max(0, Math.round(signals.directoryCount ?? 0))
  const complexity = signals.complexity ?? 'moderate'
  const excludedDirs = [...DEFAULT_EXCLUDED_DIRS]

  // --- 1) Çok küçük kapsam: tek ajan (paralellik maliyeti kazancı aşar) ---
  if (files > 0 && files < 15) {
    return {
      count: 1,
      concurrency: 1,
      staggerMs: 0,
      excludedDirs,
      reason: `${files} dosya — tek ajan yeterli, paralellik israf olur.`
    }
  }

  // --- 2) Basit sorgu: kapsam büyük olsa da keşif derinliği düşük ---
  if (complexity === 'simple' && files < 60) {
    return {
      count: 1,
      concurrency: 1,
      staggerMs: 0,
      excludedDirs,
      reason: 'Sorgu tek yönlü; kapsam büyük olsa da tek ajan yeterli.'
    }
  }

  // --- 3) Orta kapsam: 2 ajan ---
  if (files < 60 || dirs <= 2) {
    return {
      count: 2,
      concurrency: Math.min(2, MAX_FANOUT_CONCURRENCY),
      staggerMs: DEFAULT_STAGGER_MS,
      excludedDirs,
      reason:
        files > 0
          ? `${files} dosya / ${dirs} dizin — 2 ajan kademeli çalışır.`
          : `${dirs} dizin — 2 ajan kademeli çalışır.`
    }
  }

  // --- 4) Büyük kapsam: 3-4 ajan, eşzamanlılık yine 2 ---
  const count = Math.min(4, Math.max(3, Math.ceil(files / 300), dirs >= 4 ? 4 : 3))
  const concurrency = Math.min(MAX_FANOUT_CONCURRENCY, count)
  const waves = Math.ceil(count / concurrency)
  return {
    count,
    concurrency,
    staggerMs: DEFAULT_STAGGER_MS,
    excludedDirs,
    reason:
      `${files} dosya / ${dirs} dizin — ${count} ajan, ${concurrency} eşzamanlı ` +
      `(${waves} dalga), ramp-rate limitini aşmamak için kademeli.`
  }
}

/**
 * Bir sonraki ajanın başlatılması için beklenecek süre.
 *
 * İlk `concurrency` ajan kademeli başlar; sonrası bir slot boşalınca girer.
 */
export function staggerDelayFor(index: number, plan: FanoutPlan): number {
  if (plan.staggerMs <= 0) return 0
  if (index < plan.concurrency) return index * plan.staggerMs
  // Dalga sonrası: kuyruk zaten bekliyor, ek gecikme gerekmez.
  return 0
}

/**
 * Ajan sayısını sert sınırlara göre doğrular.
 * Planlayıcı hatalı olsa bile buradan geçemez.
 */
export function validateFanout(plan: FanoutPlan): string[] {
  const problems: string[] = []
  if (plan.count < 1) problems.push('ajan sayısı en az 1 olmalı')
  if (plan.count > MAX_SUBAGENTS_PER_REQUEST) {
    problems.push(`ajan sayısı ${MAX_SUBAGENTS_PER_REQUEST} sınırını aşıyor`)
  }
  if (plan.concurrency < 1) problems.push('eşzamanlılık en az 1 olmalı')
  if (plan.concurrency > MAX_CONCURRENT_SUBAGENTS) {
    problems.push(`eşzamanlılık ${MAX_CONCURRENT_SUBAGENTS} sınırını aşıyor`)
  }
  if (plan.concurrency > plan.count) problems.push('eşzamanlılık ajan sayısını aşamaz')
  if (plan.staggerMs < 0) problems.push('gecikme negatif olamaz')
  return problems
}

/**
 * Kapsam brifingi: alt ajana verilen görev metnine eklenecek kural.
 *
 * Ajanların `node_modules`/`build` içinde adım yakmasını engeller.
 */
export function scopeBriefing(plan: FanoutPlan, root?: string): string {
  const dirs = plan.excludedDirs.slice(0, 10).join(', ')
  return (
    'KAPSAM KURALLARI:' +
    `\n- Şu dizinlere GİRME: ${dirs}. Build artefaktları mimari hakkında bilgi taşımaz, adım bütçesini tüketir.` +
    '\n- Önce `grep`/`glob` ile daralt, sonra yalnızca gereken dosyaları oku.' +
    '\n- Dosya sayısını ölç: `Get-ChildItem -Recurse -File -Exclude...` yerine hedefli `glob` kullan.' +
    (root ? `\n- Kök: ${root}` : '')
  )
}
