import { promises as fs } from 'fs'
import { join } from 'path'
import type { LighthouseReport, LighthouseSummary } from '../shared/types'

/**
 * Uygulama içi Lighthouse denetimi.
 *
 * Lighthouse 13 ESM'dir; ana süreç CommonJS olduğu için dinamik `import()`
 * kullanılır. Tarayıcı olarak sistemdeki Chrome/Edge (chrome-launcher) ya da
 * Playwright'ın indirdiği Chromium kullanılabilir.
 */

export interface LighthouseOptions {
  url: string
  /** performance | accessibility | best-practices | seo */
  categories?: LighthouseCategory[]
  /** 'mobile' (varsayılan) veya 'desktop' */
  formFactor?: 'mobile' | 'desktop'
  /** Denetlenecek ekstra audit kimlikleri. */
  extraAudits?: string[]
  /** Raporun yazılacağı klasör; verilmezse diske yazılmaz. */
  outputDir?: string
  /** Azami süre (ms). */
  timeoutMs?: number
}

export type LighthouseCategory = 'performance' | 'accessibility' | 'best-practices' | 'seo'

export const LIGHTHOUSE_CATEGORIES: LighthouseCategory[] = [
  'performance',
  'accessibility',
  'best-practices',
  'seo'
]

/** Denetlenecek adres yalnızca http(s) olabilir. */
export function normalizeAuditUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, error: 'Adres boş.' }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: `Geçersiz adres: ${value.slice(0, 120)}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // Lighthouse yalnızca http(s) kabul eder; file:// için yerel sunucu gerekir.
    return {
      ok: false,
      error: `Desteklenmeyen protokol: ${parsed.protocol} — yalnızca http(s) denetlenebilir.`
    }
  }
  if (!parsed.hostname) {
    return { ok: false, error: 'Adreste sunucu adı yok.' }
  }
  return { ok: true, url: parsed.toString() }
}

/** Lighthouse skoru (0-1) → 0-100 tam sayı. Skor yoksa null. */
export function scoreToPercent(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

interface RawAudit {
  id?: string
  title?: string
  score?: number | null
  scoreDisplayMode?: string
  displayValue?: string
  description?: string
  numericValue?: number
}

interface RawLhr {
  finalUrl?: string
  fetchTime?: string
  userAgent?: string
  categories?: Record<string, { id?: string; score?: number | null }>
  audits?: Record<string, RawAudit>
  runtimeError?: { code?: string; message?: string }
  runWarnings?: string[]
}

const KEY_AUDITS = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'total-blocking-time',
  'cumulative-layout-shift',
  'speed-index',
  'interactive',
  'total-byte-weight',
  'unused-javascript',
  'render-blocking-resources',
  'uses-responsive-images',
  'image-alt',
  'color-contrast',
  'link-name',
  'button-name',
  'document-title',
  'meta-description',
  'html-has-lang'
]

/**
 * Ham Lighthouse sonucunu arayüz/ajan için özetler.
 * Saf fonksiyon: dosya veya ağ erişimi yoktur, test edilebilir.
 */
export function summarizeLighthouse(
  lhr: RawLhr,
  extraAuditIds: string[] = []
): LighthouseSummary {
  const scores: LighthouseSummary['scores'] = {}
  for (const category of LIGHTHOUSE_CATEGORIES) {
    const entry = lhr.categories?.[category]
    const percent = scoreToPercent(entry?.score ?? null)
    if (percent !== null) scores[category] = percent
  }

  const auditIds = [...new Set([...KEY_AUDITS, ...extraAuditIds])]
  const audits: LighthouseSummary['audits'] = []
  for (const id of auditIds) {
    const audit = lhr.audits?.[id]
    if (!audit) continue
    // Yalnızca puanlanan veya ölçüm değeri olan denetimler rapora girer.
    if (audit.score === null && typeof audit.numericValue !== 'number' && !audit.displayValue) {
      continue
    }
    audits.push({
      id,
      title: String(audit.title ?? id).slice(0, 200),
      score: scoreToPercent(audit.score ?? null),
      displayValue: audit.displayValue ? String(audit.displayValue).slice(0, 120) : undefined,
      mode: audit.scoreDisplayMode
    })
  }

  // En kötü puanlı denetimler önce gelir; puanı olmayanlar sona.
  audits.sort((a, b) => {
    const left = a.score ?? 101
    const right = b.score ?? 101
    return left - right
  })

  const warnings = (lhr.runWarnings ?? []).map((item) => String(item).slice(0, 200)).slice(0, 10)
  if (lhr.runtimeError?.message) {
    warnings.unshift(`runtime: ${String(lhr.runtimeError.message).slice(0, 200)}`)
  }

  return {
    url: String(lhr.finalUrl ?? ''),
    fetchedAt: String(lhr.fetchTime ?? new Date().toISOString()),
    scores,
    audits: audits.slice(0, 40),
    warnings
  }
}

/** Özeti Markdown'a çevirir (ajan yanıtı ve rapor dosyası için). */
export function lighthouseMarkdown(summary: LighthouseSummary): string {
  const lines: string[] = []
  lines.push(`# Lighthouse — ${summary.url || '(bilinmiyor)'}`)
  lines.push(`Denetim: ${summary.fetchedAt}`)
  lines.push('')

  const labels: Record<string, string> = {
    performance: 'Performans',
    accessibility: 'Erişilebilirlik',
    'best-practices': 'En iyi uygulamalar',
    seo: 'SEO'
  }
  lines.push('| Kategori | Puan |')
  lines.push('| --- | --- |')
  for (const [key, value] of Object.entries(summary.scores)) {
    lines.push(`| ${labels[key] ?? key} | ${value} |`)
  }
  lines.push('')

  if (summary.audits.length > 0) {
    lines.push('## Öne çıkan denetimler')
    lines.push('')
    for (const audit of summary.audits.slice(0, 20)) {
      const score = audit.score === null ? '—' : audit.score
      const value = audit.displayValue ? ` (${audit.displayValue})` : ''
      lines.push(`- **${score}** · ${audit.title}${value}`)
    }
  }

  if (summary.warnings.length > 0) {
    lines.push('')
    lines.push('## Uyarılar')
    for (const warning of summary.warnings) lines.push(`- ${warning}`)
  }

  return lines.join('\n')
}

interface LaunchResult {
  port: number
  kill: () => Promise<void>
}

async function launchChrome(): Promise<LaunchResult> {
  const launcher = (await import('chrome-launcher')) as unknown as {
    launch(options?: Record<string, unknown>): Promise<{
      port: number
      kill(): Promise<void>
    }>
  }
  const chrome = await launcher.launch({
    chromeFlags: ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
  })
  return { port: chrome.port, kill: () => chrome.kill() }
}

/** Zaman aşımına karşı sarmalayıcı. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} zaman aşımına uğradı (${timeoutMs} ms)`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Lighthouse denetimini çalıştırır.
 * Hata durumunda fırlatmaz; `{ ok: false, error }` döner.
 */
export async function runLighthouseAudit(
  options: LighthouseOptions
): Promise<{ ok: true; summary: LighthouseSummary; raw: LighthouseReport } | { ok: false; error: string }> {
  const normalized = normalizeAuditUrl(options.url)
  if (!normalized.ok) return { ok: false, error: normalized.error }

  const categories = (options.categories && options.categories.length > 0
    ? options.categories
    : LIGHTHOUSE_CATEGORIES
  ).filter((category) => LIGHTHOUSE_CATEGORIES.includes(category))
  const timeoutMs = Math.max(30_000, Math.min(600_000, options.timeoutMs ?? 120_000))

  let chrome: LaunchResult | null = null
  try {
    const lighthouseModule = (await import('lighthouse')) as unknown as {
      default: (
        url: string,
        flags: Record<string, unknown>,
        config?: Record<string, unknown>
      ) => Promise<{ lhr: RawLhr; report?: unknown }>
    }
    const lighthouse = lighthouseModule.default

    chrome = await launchChrome()

    const flags: Record<string, unknown> = {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: categories,
      formFactor: options.formFactor === 'desktop' ? 'desktop' : 'mobile',
      screenEmulation:
        options.formFactor === 'desktop'
          ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
          : undefined,
      throttlingMethod: 'simulate'
    }

    const result = await withTimeout(
      lighthouse(normalized.url, flags),
      timeoutMs,
      'Lighthouse denetimi'
    )

    const summary = summarizeLighthouse(result.lhr, options.extraAudits)

    const raw: LighthouseReport = {
      url: summary.url,
      fetchedAt: summary.fetchedAt,
      scores: summary.scores,
      summary: lighthouseMarkdown(summary),
      auditCount: Object.keys(result.lhr.audits ?? {}).length,
      categories: categories.slice()
    }

    if (options.outputDir) {
      try {
        await fs.mkdir(options.outputDir, { recursive: true })
        const stamp = summary.fetchedAt.replace(/[:.]/g, '-')
        const target = join(options.outputDir, `lighthouse-${stamp}.json`)
        await fs.writeFile(target, JSON.stringify(result.lhr, null, 2), 'utf8')
        raw.reportPath = target
      } catch {
        // rapor yazılamasa da özet döner
      }
    }

    return { ok: true, summary, raw }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (chrome) {
      try {
        await chrome.kill()
      } catch {
        // yut
      }
    }
  }
}
