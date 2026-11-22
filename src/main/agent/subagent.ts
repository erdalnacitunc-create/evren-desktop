import { buildBaseBody } from '../chatShared'
import { loadEnabledSkills } from '../extensions'
import { streamCompletion } from '../sse'
import { streamWithContinuation } from '../ai/continuation'
import { resolvePermission, permissionResource, toolCategory } from '../../shared/permissions'
import type {
  AgentApprovalRequest,
  AgentMode,
  AgentProfile,
  ChatEvent,
  ChatMessage,
  ChatRequest,
  PermissionSettings
} from '../../shared/types'
import { approvalKey, waitForApproval } from './approval'
import { createTools } from './tools'
import { unknownToolMessage } from './toolSuggest'
import { listWorkspaceChanges } from '../workspace'
import { planFanout, scopeBriefing } from '../../shared/agentFanout'
import { buildSkillCatalog, buildSkillHint, routeSkills } from './skillCatalog'
import {
  progressNudgeMessage,
  shouldNudgeProgress,
  isProductiveRead,
  isCoordinationProgress,
  type StepObservation
} from './progressGuard'
import { logSubagent } from './subagentLog'
import { isAiError } from '../ai/error'
import { performanceProfile } from './hardwareProfile'
import { isTrimmableTool, trimToolOutput } from './toolOutput'
import { runWithConcurrency, shouldRunInParallel } from './toolRunner'
import {
  appendPrefetch,
  extractCandidates,
  prefetchFiles,
  prefetchNote
} from './prefetch'
import { buildReviewBrief } from './reviewBrief'
import { currentReadRoots } from '../workspace'
import { withModelSlot } from './modelGate'
import {
  excerpt,
  formatVerifyVerdict,
  GATE_CHECK_NAMES,
  isMutatingTool,
  runVerifyGate,
  selfCheckRetryMessage,
  shouldVerify,
  verifyRetryMessage,
  type VerifyVerdict
} from './verifyGate'

export type SubagentType = 'explore' | 'review' | 'general'

export interface SubagentOptions {
  parentRequestId: string
  baseUrl: string
  apiKey: string
  model: string
  agentType: SubagentType
  prompt: string
  workspaceRoot: string | null
  sessionId?: string
  mode: AgentMode
  profile: AgentProfile
  permissions?: PermissionSettings
  controller: AbortController
  send: (event: ChatEvent) => void
  approval?: (request: AgentApprovalRequest) => Promise<boolean>
  /** Görev kimliği: araç çağrılarını bu alt ajana atfetmek için. */
  subagentTaskId?: string
  /**
   * Bu ajanın yazabileceği yollar. Boşsa kısıt yok.
   * Doluysa araç düzeyinde zorlanır — liste dışına yazma reddedilir.
   */
  ownedFiles?: string[]
  /** Kısa etiket: arayüzde ve alt ajan günlüğünde görünür. */
  description?: string
  /**
   * Devam ettirilen konuşmanın önceki iletileri.
   *
   * `task_continue` ile aynı alt ajan yeniden çalıştırıldığında önceki
   * görev ve sonuç buraya konur; ajan sıfırdan başlamaz. opencode aynı
   * çocuk oturumuna (`sessionID`) mesaj ekleyerek yapar; Claude Code
   * `resume` ile. Bizde araç döngüsü durumsuz olduğu için özet geçmiş
   * yeterli: ajanın amacı, önceki bulguları ve yeni istek.
   */
  history?: ChatMessage[]
  /**
   * Canlı ilerleme bildirimi. Ana ajan `task_status` ile "takıldı mı, kaç
   * araç kullandı" görebilsin diye her adım/araçta çağrılır.
   */
  onProgress?: (progress: {
    step: number
    toolCalls: number
    lastTool?: string
  }) => void
}

/**
 * Alt ajan adım/araç sınırları.
 *
 * Neden 20/30: canlı koşuda (plc_proje analizi) model 4 paralel `explore`
 * ajanı başlattı ve **dördü de** 10 adımda limite takıldı. Her ajan 16 dosya
 * okuyordu; 10 adım yetmedi. Sonuç: hepsi boş metin döndürdü ve ana ajan
 * alt ajanları hiç kullanamadı.
 *
 * Anthropic: basit bilgi toplama 3-10 araç çağrısı, karşılaştırma 10-15.
 * 16 dosyalık içerik okuma + sentez için 20 adım/30 çağrı gerçekçi üst sınır.
 */
const MAX_STEPS = 20
const MAX_TOOL_CALLS = 30
/**
 * Yumuşak son tarih.
 *
 * ## Neden 600 sn (0.4.18)
 *
 * 0.4.14'te iki explore ajanı 482 ve 575 sn sürdü ama bütçe **fiilen
 * uygulanmıyordu**: kontrol yalnızca adım başında yapılıyor, tek bir uzun
 * model üretimini kesemiyordu. 0.4.15'te bütçe akışa uygulandı (doğru),
 * ama 420 sn seçildi ve canlı koşuda (0.4.18 faz 1) **üç ajanın üçü de**
 * uzun rapor üretirken kesildi (`akış bütçesi doldu (387 sn)`).
 *
 * Ölçüm: bu sağlayıcıda 4-8 bin karakterlik rapor tek parçada 200-400 sn
 * üretim demek; üstüne okuma turları eklenince 420 sn dar kalıyor. 600 sn
 * derin incelemeyi kesmeden sonsuz kaçışı hâlâ engeller.
 *
 * Bütçe **akışa** uygulanır: her LLM çağrısına kalan süre
 * `totalTimeoutMs` olarak geçirilir. Dolunca üretim kesilir ve ajan elindeki
 * metni **kısmi sonuç** olarak döndürür (`task_continue` ile sürdürülebilir).
 * `EVREN_SUBAGENT_DEADLINE_MS` ile değiştirilebilir.
 */
function deadlineMs(): number {
  const override = Number(process.env['EVREN_SUBAGENT_DEADLINE_MS'])
  return Number.isFinite(override) && override >= 5_000 ? override : 600_000
}

/**
 * Alt ajan raporunun **kelime bütçesi**.
 *
 * ## Neden (0.4.19)
 *
 * 0.4.18 üç fazlı canlı koşusunun ölçümü:
 *
 * | | |
 * |---|---|
 * | Alt ajan adımı başına ortalama | **88 sn** |
 * | Araç süresi payı | **<%2** (araçlar 0,2–2,7 sn) |
 * | En uzun tek adım | **503 sn** |
 * | Faz 2'de kısmi sonuç | 3/3 |
 *
 * Yani süre araçlarda değil, modelin **tek parçada 4-8 bin karakterlik rapor**
 * üretmesinde. 600 sn'lik bütçenin tamamı tek bir üretim turunda tükenebiliyor;
 * bütçeyi artırmak süreyi uzatıyor ama kısmi sonucu çözmüyor.
 *
 * Model "detaylı rapor" istendiğini varsayıp uzun paragraflar yazıyor. Kısa ve
 * madde işaretli bir rapor aynı bilgiyi taşır, üretim süresini 2-3 katına
 * düşürür ve kesilme riskini azaltır. 450 kelime (~3000 karakter) bu proje
 * için bol: canlı raporlar zaten 400-900 kelime aralığındaydı.
 */
const MAX_REPORT_WORDS = 450

/** Raporda kesin sınır — isteme gömülür. */
const REPORT_BUDGET_NOTE =
  `\n\nRAPOR BÜTÇESİ: Sonucun **en fazla ${MAX_REPORT_WORDS} kelime** olsun. ` +
  'Uzun paragraf yazma; başlık + madde işareti kullan. Kod bloğu dökme, ' +
  'yalnızca `dosya:satır` referansı ver. Her satır yeni bilgi taşımalı; ' +
  'giriş/sonuç/özet paragrafları yazma. Sınırı aşarsan yanıt kesilir ve ' +
  'ana ajan eksik bilgi alır.'

/**
 * Metnin yaklaşık kelime sayısı.
 *
 * Türkçe eklemeli bir dil olduğu için basit boşluk sayımı yeterli: rapor
 * uzunluğunu ölçmek için kesin dilbilimsel analiz gerekmiyor.
 */
export function countWords(text: string): number {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Rapor bütçesini uygular.
 *
 * Kesme **kelime sınırında** yapılır: cümle ortasında karakter kesmek yarım
 * kelime bırakır ve modelin bir sonraki turunda kafa karıştırır. Sınır
 * aşılırsa son tam cümle bulunur ve kısa bir not eklenir.
 *
 * Neden kod tarafında da zorlanıyor: istem "450 kelime" dese de model
 * aşabilir. Kod tarafı garanti verir; istem yalnızca kaliteyi artırır.
 */
export function applyReportBudget(
  text: string,
  maxWords = MAX_REPORT_WORDS
): { text: string; truncated: boolean; words: number } {
  const words = countWords(text)
  if (words <= maxWords) return { text, truncated: false, words }

  // Kelime sınırına kadar al.
  const tokens = text.trim().split(/\s+/)
  const head = tokens.slice(0, maxWords).join(' ')

  // Son cümle sonunu bul; en az yarısı korunacaksa orada kes.
  const lastStop = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('.\n'),
    head.lastIndexOf('; '),
    head.lastIndexOf('\n- ')
  )
  const base = lastStop > head.length * 0.5 ? head.slice(0, lastStop + 1) : head

  return {
    text: `${base}\n\n_[Rapor ${maxWords} kelime bütçesine kısaltıldı; ayrıntı için ana ajan ` +
      'gerekirse aracı kendisi çağırabilir.]_',
    truncated: true,
    words
  }
}

/** Bütçenin bu oranı dolunca modele "toparla" hatırlatması gider. */
const DEADLINE_NUDGE_RATIO = 0.75

/**
 * Doğrulama kapısının modeli en fazla kaç kez geri gönderebileceği (0.4.24).
 *
 * Pratikte 1 tur yeterli: kapı hatayı gösterir, model düzeltir. Üst sınır 2;
 * ikinci tur, ilk düzeltme eksik kaldığında son şanstır. Daha fazlası,
 * düzeltmeyen bir modelde yalnızca token yakar (Stroebl et al.: doğrulayıcı
 * ayırt etmiyorsa N'i artırmak fayda değil maliyet üretir).
 */
const MAX_VERIFY_ROUNDS = 2

/**
 * Son tarih yaklaşırken modele gönderilen hatırlatma.
 *
 * Neden: 0.4.14'te ajanlar bütçeyi aşıp tek parça 291/423 sn ürettiler.
 * Kesilmeden önce "elindekini yaz" demek, kısmi sonucun işe yarar olmasını
 * sağlar (Claude Code `maxTurns` davranışı).
 */
const SUBAGENT_DEADLINE_NUDGE =
  'BÜTÇE UYARISI: Sürenin yaklaşık dörtte üçü doldu. **Şimdi araç çağırmayı bırak** ve ' +
  'elindeki doğrulanmış bulguları yaz. Raporu kısa maddeler hâlinde ver ' +
  '(başlık + madde işaretleri), uzun paragraflardan kaçın, kod bloğu dökme. ' +
  'Eksik kalan noktaları "doğrulanmadı" diye işaretle. ' +
  `En fazla ${MAX_REPORT_WORDS} kelime. Bütçe dolduğunda üretim kesilir ve raporun yarım kalır.`

/**
 * Limite takılan alt ajanı **metin yazmaya** zorlar.
 *
 * ## Neden
 *
 * Canlı koşuda (plc_proje, 4 paralel explore) dört ajanın dördü de adım
 * limitine takıldı ve boş sonuç döndürdü:
 *
 *   "Alt ajan adım limitine takıldı.\n\n"   ← sonrası boş
 *
 * Sebep: ajan tüm adımlarını araç çağrısına harcadı, hiç metin üretmedi.
 * Ana ajan dört boş sonuç aldı; yani alt ajanlar tamamen boşa gitti.
 *
 * ## Çözüm
 *
 * Ana döngüdeki `finalizeRun` ile aynı desen: araç tanımları **dolu**
 * gönderilir (0.4.4 dersi: boş dizi sağlayıcıda hata verir), çağrı
 * `tool_choice: 'none'` ile engellenir ve modelden elindeki bulguları
 * yazması istenir. Böylece her zaman metin döner.
 */
/**
 * Tek bir araç çağrısına süre sınırı koyar.
 *
 * Neden: canlı koşuda alt ajanın çalıştırdığı `Get-ChildItem -Recurse` 3 GB'lık
 * bir dizinde dakikalarca sürdü ve ajanın 210 sn'lik bütçesini tek başına
 * tüketti. Alt ajan araçlarına sinyal geçirilmiyordu, yani durdurulamıyordu.
 */
const TOOL_TIMEOUT_MS = 90_000



async function runToolWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs = TOOL_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController()
  const onParentAbort = (): void => controller.abort()
  parentSignal.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', onParentAbort)
  }
}

/**
 * Alt ajanın değiştirdiği dosyaları kısa bir listeye çevirir.
 *
 * `general` ajanı yazabildiği için ana ajanın ne değiştiğini bilmesi gerekir;
 * aksi hâlde kodlama devri "kara kutu" olur (Cognition'ın uyardığı görünürsüzlük).
 */
async function changedFilesReport(before: number): Promise<string> {
  try {
    const changes = await listWorkspaceChanges(500)
    const fresh = changes.slice(0, Math.max(0, changes.length - before))
    if (fresh.length === 0) return ''
    const lines = fresh
      .slice(0, 20)
      .map((change) => {
        const action =
          change.action === 'write'
            ? 'yazıldı'
            : change.action === 'edit'
              ? 'düzenlendi'
              : change.action === 'delete'
                ? 'silindi'
                : change.action
        return `- ${change.path} (${action})`
      })
      .join('\n')
    return `\n\nDeğişen dosyalar (${fresh.length}):\n${lines}`
  } catch {
    return ''
  }
}

async function finalizeSubagent(input: {
  messages: ChatMessage[]
  request: ChatRequest
  baseUrl: string
  apiKey: string
  controller: AbortController
  tools: unknown[]
  reason: 'steps' | 'tools' | 'deadline'
}): Promise<string> {
  const limitNote =
    input.reason === 'steps'
      ? 'Adım sınırına ulaştın.'
      : input.reason === 'deadline'
        ? 'Süre bütçen doldu.'
        : 'Araç çağrısı sınırına ulaştın.'
  const note =
    limitNote +
    ' Yeni araç çağırma. Şimdiye kadar topladığın bulguları, dosya:satır referanslarıyla ' +
    'birlikte düzenli bir rapor olarak YAZ. Eksik kalan noktaları "doğrulanamadı" diye işaretle.' +
    REPORT_BUDGET_NOTE

  const body = {
    ...buildBaseBody(input.request),
    messages: [...input.messages, { role: 'user' as const, content: note }],
    ...(input.tools.length > 0
      ? { tools: input.tools, tool_choice: 'none' as const }
      : {})
  }

  try {
    const result = await withModelSlot(
      'sub',
      () =>
        streamCompletion(
          input.baseUrl,
          input.apiKey,
          body,
          input.controller.signal,
          () => undefined
        ),
      input.controller.signal
    )
    const text = (result.content ?? '').trim()
    if (text) return text
  } catch {
    // Sentez başarısız olsa da aşağıdaki yedek metin döner.
  }

  return (
    'Alt ajan limite ulaştı ve sentez üretemedi. ' +
    'Toplanan araç çıktıları ana bağlamda; gerekirse doğrudan oku.'
  )
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function agentInstruction(
  type: SubagentType,
  prompt: string,
  workspaceRoot: string | null,
  ownership: { readOnly: boolean; ownedFiles?: string[] }
): string {
  const base =
    type === 'explore'
      ? 'Sen bir keşif alt ajanısın. Kod tabanını oku, ilgili dosyaları ve satırları bul, kanıtla birlikte kısa ve yoğun bir özet döndür. Dosya değiştirme.'
      : type === 'review'
        ? 'Sen bir kod inceleme alt ajanısın. Hataları, güvenlik risklerini, performans ve bakım sorunlarını incele. Dosya değiştirme; somut öneriler ve dosya:satır referansları ver.'
        : 'Sen bir genel görev alt ajanısın. Verilen görevi çalışma alanı araçlarıyla tamamla. Değişiklik yaparsan ne yaptığını ve sonucu özetle.'
  const workspace = workspaceRoot ? `\nÇalışma alanı: ${workspaceRoot}` : ''
  // Verimlilik kuralları. Canlı koşuda 4 explore ajanı 16 dosyayı tek tek
  // okumaya çalışıp adım limitine takıldı ve BOŞ sonuç döndürdü.
  // Kapsam disiplini: build artefaktları adım bütçesini yakar.
  // Canlı koşuda ajanlar 3 GB'lık master\ ve mobil\ dizinlerinde
  // node_modules/build içine girip "kısmi" rapor döndürdü.
  const scope = scopeBriefing(planFanout())

  // Çalışma alanı dışı: kullanıcı masaüstündeki bir klasörü sorduysa alt ajan
  // da `read_file` ile okuyamaz (kapsam koruması). Canlı koşuda bu yüzden
  // alt ajanlar PowerShell'e düşmek zorunda kaldı.
  // Sahiplik: yazabilen ajana hangi dosyaların ait olduğunu söyle.
  // Araç düzeyinde de zorlanır; bu yalnızca modelin boşa denemesini önler.
  const ownershipNote =
    !ownership.readOnly && ownership.ownedFiles && ownership.ownedFiles.length > 0
      ? '\n\nDOSYA SAHİPLİĞİ: Yalnızca şu yollara yazabilirsin: ' +
        (ownership.ownedFiles ?? []).join(', ') +
        '.\nListe dışındaki bir dosyayı düzenlemen gerekirse DURDUR ve sonuçta ' +
        '"şu dosya da gerekli" diye bildir. Kendi izin listeni genişletmeye çalışma; ' +
        'araç reddeder. Diğer dosyaları **okuyabilirsin** (kısıt yok).'
      : ''

  /**
   * Çalışma alanı dışı davranışı (0.4.25).
   *
   * 0.4.24 canlı koşusunda bu not **yanlıştı**: salt-okunur ajana "run_command
   * kullan" diyordu, o araç ise salt-okunur ajanda hiç yok. İki `explore` ajanı
   * 6 dakika boyunca olmayan aracı aradı. Artık tarif, ajanın **gerçekten sahip
   * olduğu** yeteneğe göre yazılır.
   */
  const readRoots = currentReadRoots()
  const outsideNote =
    workspaceRoot && /\b[A-Za-z]:\\/.test(prompt)
      ? readRoots.length > 0
        ? '\n\nÇALIŞMA ALANI DIŞI: Görevdeki mutlak yollar çalışma alanının dışında. ' +
          'Şu kökler **salt-okunur** açık; `read_file`/`list_files`/`glob`/`grep` ile ' +
          'mutlak yol vererek okuyabilirsin:\n' +
          readRoots.map((root) => `- ${root}`).join('\n') +
          '\nBu köklerin dışına çıkma; yazma yapamazsın.'
        : '\n\nÇALIŞMA ALANI DIŞI: Görevdeki mutlak yollar çalışma alanının dışında ve ' +
          'bu koşuda dış okuma izni **yok**. `read_file`/`glob`/`grep` reddeder; ' +
          '`run_command` bu ajan türünde tanımlı değildir. Bu yüzden araç denemeleriyle ' +
          'adım harcama: hemen "doğrulanamadı — çalışma alanı dışı erişim yok" diye ' +
          'kısa bir sonuç döndür ve ana ajana dosyaların okunamadığını bildir.'
      : ''
  const efficiency =
    '\n\nVERİMLİLİK:' +
    '\n- Aynı adımda birden çok dosyayı oku: tek yanıtta birden fazla `read_file` çağrısı yap (paralel araç çağrısı). ' +
    'Dosyaları tek tek okumak adım bütçesini tüketir.' +
    '\n- Önce daralt: `grep`/`glob` ile ilgili dosyaları bul, sonra yalnızca gerekenleri oku.' +
    '\n- 3-5 adım içinde bulgu yazmaya başla; her adımda kısa not düş. Tek büyük raporu ' +
    'sona bırakma — üretim uzarsa bütçe dolar ve rapor kesilir.' +
    '\n- Rapor yazarken araç çağırma; elindekiyle bitir, eksikleri "doğrulanamadı" diye işaretle.' +
    REPORT_BUDGET_NOTE
  return `${base}${workspace}${ownershipNote}${scope}${outsideNote}${efficiency}\n\nGörev:\n${prompt}\n\nYalnızca ana ajana dönük kısa bir sonuç üret; kullanıcıya doğrudan hitap etme. Gereksiz araç çıktısını tekrar etme.`
}

export interface SubagentResult {
  ok: boolean
  content: string
  /** Sonuç eksik: bütçe/süre nedeniyle kesildi. */
  partial?: boolean
  partialReason?: 'steps' | 'tools' | 'deadline' | 'tool-timeout'
  /**
   * Yazma yapıldıysa doğrulama kapısının sonucu (0.4.24).
   * `undefined` = kapı uygulanmadı (yazma yok ya da salt-okunur ajan).
   * `false` = kapı çalıştı ve geçmedi **veya** ölçülemedi (kontrol tanımsız).
   * Asla "ölçülmedi ama geçti" demez.
   */
  verified?: boolean
  /** Ana ajana gösterilecek kısa doğrulama özeti. */
  verify?: { ran: boolean; ok: boolean; summary: string }
}

export async function runSubagent(options: SubagentOptions): Promise<SubagentResult> {
  const {
    parentRequestId,
    baseUrl,
    apiKey,
    model,
    agentType,
    prompt,
    workspaceRoot,
    sessionId,
    mode,
    profile,
    permissions,
    controller,
    send,
    subagentTaskId,
    ownedFiles,
    description,
    history,
    onProgress
  } = options

  const skills = await loadEnabledSkills()
  const readOnly = agentType !== 'general' || profile === 'plan'

  /**
   * `review` ajanı: bu oturumdaki değişikliklerin diff'i hazır bağlam olarak
   * verilir (0.4.24). Ajan geçmişsiz — kodu yazan konuşmayı görmez — ama
   * neyi inceleyeceğini keşfetmek için adım harcamaz.
   */
  let taskPrompt = prompt
  if (agentType === 'review' && (history?.length ?? 0) === 0) {
    const brief = await buildReviewBrief()
    if (brief.text) {
      taskPrompt = `${brief.text}\n\n---\n\n${prompt}`
      logSubagent({
        phase: 'start',
        taskId: subagentTaskId,
        requestId: parentRequestId,
        agentType,
        msg: `inceleme paketi hazır: ${brief.files.length} dosya`,
        data: { files: brief.files, omitted: brief.omitted, briefChars: brief.text.length }
      })
    }
  }

  const registry = createTools({
    browser: false,
    computer: false,
    skills,
    workspace: workspaceRoot ? { root: workspaceRoot, sessionId } : undefined,
    readOnly,
    // Sahiplik listesi yalnızca yazabilen ajana anlamlı; salt-okunur ajanlara
    // geçirilmez (onlar zaten yazamaz).
    allowedWritePaths: readOnly ? undefined : ownedFiles
  })

  // Alt ajana da skill kataloğu verilir; gövde yüklemez, yalnızca göreve
  // uygun olanları işaretler. Alt ajan "beceri var" bilgisiyle çalışır ama
  // bağlamı şişirmez.
  const routedForCatalog = routeSkills(skills, taskPrompt)
  const skillCatalog = buildSkillCatalog(skills, {
    highlighted: routedForCatalog.map((skill) => skill.id)
  })

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        agentInstruction(agentType, taskPrompt, workspaceRoot, { readOnly, ownedFiles }) +
        skillCatalog.text +
        buildSkillHint(routedForCatalog)
    },
    // Devam turunda önceki görev ve sonuç bağlam olarak eklenir. Aksi hâlde
    // "devam et" isteği sıfırdan bir koşuya dönüşür ve ajan neyi sürdürdüğünü
    // bilemez (opencode'un aynı çocuk oturumuna mesaj eklemesi gibi).
    ...(history ?? []),
    { role: 'user', content: taskPrompt }
  ]

  /**
   * Ön okuma (warm start): istemde adı geçen dosyaları biz okuyup bağlama
   * koyarız. Model "listele → tek tek oku → daralt" turlarında 2-5 adım
   * harcıyor; her adım 60-90 sn. Bu, doğrudan kazanç.
   *
   * Yalnızca salt-okunur ajanlarda: yazma yapan ajan kendi akışını kursun.
   */
  const prefetched = readOnly
    ? await prefetchFiles({
        root: workspaceRoot,
        candidates: extractCandidates(taskPrompt, ownedFiles ?? [])
      }).catch(() => [])
    : []
  if (prefetched.length > 0) {
    // Önce kullanıcı iletisine notu ekle (ön okuma iletileri ondan SONRA
    // ekleneceği için sıralama doğru kalır).
    const userMessage = messages[messages.length - 1]
    if (userMessage && userMessage.role === 'user' && typeof userMessage.content === 'string') {
      userMessage.content = userMessage.content + prefetchNote(prefetched)
    }
    appendPrefetch(messages as unknown as Array<Record<string, unknown>>, prefetched)
    // Ön okumayı arayüze de yansıt: alt ajanın hangi dosyaları hazır aldığı
    // görünmeli (0.4.13 dersi: alt ajan eylemleri görünmez olmasın).
    for (const [index, file] of prefetched.entries()) {
      send({
        requestId: parentRequestId,
        type: 'tool-call',
        call: {
          id: `prefetch-${index}`,
          name: 'read_file',
          arguments: JSON.stringify({ path: file.path }),
          agentType,
          subagentTaskId
        }
      })
      send({
        requestId: parentRequestId,
        type: 'tool-result',
        result: {
          toolCallId: `prefetch-${index}`,
          name: 'read_file',
          ok: true,
          content: `ÖN OKUMA: ${file.path} (${file.content.length} kr)`,
          agentType,
          subagentTaskId
        }
      })
    }
  }

  const request: ChatRequest = { model, messages }
  const startedAt = Date.now()
  logSubagent({
    phase: 'start',
    taskId: subagentTaskId,
    requestId: parentRequestId,
    agentType,
    msg: `alt ajan başladı${description ? ` — ${description}` : ''}`,
    data: {
      model,
      readOnly,
      ownedFiles: ownedFiles ?? [],
      promptLength: taskPrompt.length,
      workspaceRoot: workspaceRoot ?? null,
      continuation: (history?.length ?? 0) > 0,
      prefetchedFiles: prefetched.map((file) => file.path),
      prefetchedChars: prefetched.reduce((sum, file) => sum + file.content.length, 0),
      maxSteps: MAX_STEPS,
      maxToolCalls: MAX_TOOL_CALLS,
      deadlineMs: deadlineMs()
    }
  })
  /**
   * Yazma yetkili alt ajan (general) hangi dosyaları değiştirdi?
   *
   * Neden: alt ajan sonucu yalnızca metin döndürüyordu. Ana ajan, general
   * ajanın hangi dosyalara dokunduğunu göremiyordu — kodlama devrinde bu
   * ciddi bir görünürsüzlük. Artık değişen dosyalar sonuca eklenir.
   */
  let changesBefore = 0
  if (!readOnly && workspaceRoot) {
    try {
      changesBefore = (await listWorkspaceChanges(500)).length
    } catch {
      changesBefore = 0
    }
  }
  let toolCallCount = 0
  let finalContent = ''
  /** İlerlemesiz adım koruması: ana döngüdeki progressGuard'ın alt ajan sürümü. */
  const stepHistory: StepObservation[] = []
  let nudgesSent = 0

  // ---- Doğrulama kapısı durumu (0.4.24) ----
  /** Bu koşuda yazılan yollar. Kapı yalnızca yazma olduysa çalışır. */
  const mutatedPaths = new Set<string>()
  /** En son yazmanın yapıldığı araç sayacı (modelin kendi `run_checks`'iyle karşılaştırılır). */
  let lastMutationAt = -1
  /** Model kendi `run_checks`'ini çalıştırdıysa sonucu: aynı kontrolü iki kez koşmayalım. */
  let lastSelfCheck: { atToolCall: number; ok: boolean; content: string } | undefined
  /** Son kapı sonucu — rapora eklenir. */
  let lastVerify: SubagentResult['verify'] | undefined
  let verifyRounds = 0

  /**
   * Kısmi sonuç üretirken dürüstlük notu.
   *
   * Bütçe kesintisi doğrulamayı imkânsız kılar; bu "geçti" sayılamaz.
   * 0.4.16 dersinin devamı: ölçülemeyen şey başarı olarak sunulmaz.
   */
  const finalizePartial = async (
    content: string,
    reason: NonNullable<SubagentResult['partialReason']>
  ): Promise<SubagentResult> => {
    const mutations = await hasMutations().catch(() => 0)
    const note =
      mutations > 0
        ? '\n\nDOĞRULAMA: çalıştırılmadı — koşu bütçe nedeniyle kesildi. ' +
          'Değişiklikler **doğrulanmadı**; `run_checks` ile doğrula.'
        : ''
    return {
      ok: true,
      content: content + note,
      partial: true,
      partialReason: reason,
      ...(note ? { verified: false } : {})
    }
  }


  /**
   * Bu koşuda çalışma alanı değişti mi?
   *
   * `mutatedPaths` yalnızca doğrudan yazma araçlarını görür. `general` ajanı
   * `run_command` ile de dosya değiştirebilir (ör. `git checkout`, betik).
   * Değişiklik günlüğü (`changesBefore`) her iki yolu da kapsar; kapıyı
   * kaçırmamak için iki sinyal birleştirilir.
   */
  const hasMutations = async (): Promise<number> => {
    if (mutatedPaths.size > 0) return mutatedPaths.size
    if (readOnly || !workspaceRoot) return 0
    try {
      const changes = await listWorkspaceChanges(500)
      return Math.max(0, changes.length - changesBefore)
    } catch {
      return 0
    }
  }

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (controller.signal.aborted) {
        logSubagent({
          phase: 'finish',
          level: 'warn',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: 'alt ajan iptal edildi',
          data: { step, toolCalls: toolCallCount, elapsedMs: Date.now() - startedAt }
        })
        return { ok: false, content: 'Alt ajan durduruldu.' }
      }
      // Bütçe hatırlatması: son tarihin %75'i dolduysa modeli toparlamaya
      // yönlendir. Aksi hâlde bütçe dolduğunda yarım cümleyle kesilir.
      if (
        nudgesSent === 0 &&
        Date.now() - startedAt > deadlineMs() * DEADLINE_NUDGE_RATIO
      ) {
        nudgesSent += 1
        messages.push({ role: 'user', content: SUBAGENT_DEADLINE_NUDGE })
        logSubagent({
          phase: 'budget',
          level: 'warn',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: "bütçenin %75'i doldu — toparlama hatırlatması",
          data: { step, toolCalls: toolCallCount, elapsedMs: Date.now() - startedAt }
        })
      }
      // Yumuşak son tarih: ana ajanın task_wait süresinden önce bitir.
      if (Date.now() - startedAt > deadlineMs()) {
        logSubagent({
          phase: 'budget',
          level: 'warn',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: `son tarih aşıldı (${deadlineMs()} ms) — sentez turuna geçiliyor`,
          data: { step, toolCalls: toolCallCount, elapsedMs: Date.now() - startedAt }
        })
        const synthesized = await finalizeSubagent({
          messages,
          request,
          baseUrl,
          apiKey,
          controller,
          tools: registry.definitions(),
          reason: 'deadline'
        })
        const changedDeadline = readOnly ? '' : await changedFilesReport(changesBefore)
        logSubagent({
          phase: 'finish',
          level: 'warn',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: 'alt ajan kısmi sonuç döndürdü',
          data: { partialReason: 'deadline', contentLength: synthesized.length }
        })
        return await finalizePartial(
          applyReportBudget(synthesized + changedDeadline).text,
          'deadline'
        )
      }
      const body = {
        ...buildBaseBody(request),
        messages,
        tools: registry.definitions(),
        tool_choice: 'auto'
      }
      /**
       * Bütçeyi **akışa** uygula. 0.4.14'te yalnızca adım başında kontrol
       * ediliyordu; tek bir uzun üretim (291/423 sn) bütçeyi aşabiliyordu.
       * Kalan süre `totalTimeoutMs` olarak verilir; dolunca üretim kesilir ve
       * aşağıdaki `catch` elindeki metni kısmi sonuca çevirir.
       */
      const budgetLeft = Math.max(10_000, deadlineMs() - (Date.now() - startedAt))
      let result
      try {
        result = await streamWithContinuation({
          messages: body.messages as ChatMessage[],
          signal: controller.signal,
          onDelta: () => undefined,
          run: (messagesToSend) =>
            withModelSlot(
              'sub',
              () =>
                streamCompletion(
                  baseUrl,
                  apiKey,
                  { ...body, messages: messagesToSend },
                  controller.signal,
                  () => undefined,
                  { totalTimeoutMs: Math.max(5_000, deadlineMs() - (Date.now() - startedAt)) }
                ),
              controller.signal
            )
        })
      } catch (caught) {
        const isTimeout =
          isAiError(caught) && caught.reason.tag === 'Timeout' && !controller.signal.aborted
        if (!isTimeout) throw caught
        // Zaman aşımı: üretilen metni kurtar, gerisini "kısmi" işaretle.
        const salvaged = isAiError(caught) ? caught.partialContent : ''
        logSubagent({
          phase: 'budget',
          level: 'warn',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: `akış bütçesi doldu (${Math.round(budgetLeft / 1000)} sn) — üretim kesildi`,
          data: {
            step,
            toolCalls: toolCallCount,
            elapsedMs: Date.now() - startedAt,
            salvagedLength: salvaged.length
          }
        })
        const base = (salvaged || finalContent).trim()
        const changedTimeout = readOnly ? '' : await changedFilesReport(changesBefore)
        const note = base
          ? '\n\n_[Süre bütçesi doldu; rapor üretim ortasında kesildi. Eksik kısımlar ' +
            '`task_continue` ile tamamlanabilir.]_'
          : 'Süre bütçesi doldu ve görünür çıktı üretilmedi. `task_continue` ile ' +
            'görevi daha dar kapsamla sürdür.'
        logSubagent({
          phase: 'finish',
          level: 'warn',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: 'alt ajan kısmi sonuç döndürdü',
          data: { partialReason: 'deadline', contentLength: base.length }
        })
        return await finalizePartial(
          applyReportBudget(base + note + changedTimeout).text,
          'deadline'
        )
      }
      if (result.content) finalContent = result.content
      onProgress?.({ step: step + 1, toolCalls: toolCallCount })
      logSubagent({
        phase: 'step',
        taskId: subagentTaskId,
        requestId: parentRequestId,
        agentType,
        msg: `adım ${step + 1}/${MAX_STEPS}`,
        data: {
          step: step + 1,
          contentLength: (result.content ?? '').length,
          toolCalls: result.toolCalls.length,
          finishReason: result.finishReason ?? null,
          elapsedMs: Date.now() - startedAt
        }
      })

      if (result.toolCalls.length === 0) {
        // ---- Doğrulama kapısı (0.4.24) ----
        // Yazma yapıldıysa "bitti" demeden önce kontrolleri **biz** çalıştırırız.
        // Model "testler geçti" diyebilir; geçtiğini yalnızca araç kanıtlar.
        const mutationCount = await hasMutations()
        if (shouldVerify({ readOnly, mutations: mutationCount }) && !controller.signal.aborted) {
          const reuseSelfCheck =
            lastSelfCheck !== undefined && lastSelfCheck.atToolCall >= lastMutationAt
          // Kapı da bütçeden yer kaplar. Son tarihe çok az kaldıysa uzun bir
          // typecheck/test koşusu başlatmak, koşuyu süre aşımına itmek demek.
          const budgetLeftMs = deadlineMs() - (Date.now() - startedAt)
          const MIN_GATE_BUDGET_MS = 20_000

          if (!reuseSelfCheck && budgetLeftMs < MIN_GATE_BUDGET_MS) {
            lastVerify = {
              ran: false,
              ok: false,
              summary:
                'DOĞRULAMA: çalıştırılmadı — süre bütçesinde yer kalmadı. ' +
                'Değişiklikler **doğrulanmadı**; `run_checks` ile doğrula.'
            }
            logSubagent({
              phase: 'verify',
              level: 'warn',
              taskId: subagentTaskId,
              requestId: parentRequestId,
              agentType,
              msg: 'doğrulama bütçe yetersizliğinden atlandı',
              data: { budgetLeftMs, mutations: mutationCount }
            })
          } else if (reuseSelfCheck) {
            // Model zaten yazmadan SONRA `run_checks` çalıştırmış: aynı işi
            // tekrar koşmak süre kaybı. Onun sonucu kanıt sayılır.
            const selfOk = lastSelfCheck!.ok
            lastVerify = {
              ran: true,
              ok: selfOk,
              summary: selfOk
                ? 'DOĞRULAMA: ✓ geçti — ajanın kendi `run_checks` sonucu'
                : 'DOĞRULAMA: ✗ **BAŞARISIZ** — ajanın kendi `run_checks` sonucu\n' +
                  excerpt(lastSelfCheck!.content)
            }
            // Kendi kontrolü başarısızsa da düzeltmeye geri gönder: aksi hâlde
            // ajan "testler geçti" diyemez ama hatayı düzeltme şansı da olmaz.
            if (
              !selfOk &&
              verifyRounds < MAX_VERIFY_ROUNDS &&
              step + 1 < MAX_STEPS
            ) {
              verifyRounds += 1
              if ((result.content ?? '').trim()) {
                messages.push({ role: 'assistant', content: result.content })
              }
              messages.push({
                role: 'user',
                content: selfCheckRetryMessage(lastSelfCheck!.content)
              })
              logSubagent({
                phase: 'verify',
                level: 'warn',
                taskId: subagentTaskId,
                requestId: parentRequestId,
                agentType,
                msg: `doğrulama turu ${verifyRounds}/${MAX_VERIFY_ROUNDS} (kendi run_checks) — model düzeltmeye gönderildi`
              })
              step -= 1
              // Sonraki tur yeni bir yazma yapmazsa aynı başarısız kanıt
              // yeniden kullanılmasın: kanıt "tüketildi" sayılır.
              lastSelfCheck = undefined
              continue
            }
          } else {
            try {
              const verdict: VerifyVerdict = await runVerifyGate(GATE_CHECK_NAMES, {
                // Bütçenin tamamını kapıya verme: koşunun ve sentezin de payı var.
                timeoutMs: Math.max(5_000, budgetLeftMs - 10_000)
              })
              lastVerify = {
                ran: verdict.ran,
                ok: verdict.ok,
                summary: formatVerifyVerdict(verdict)
              }
              logSubagent({
                phase: 'verify',
                level: verdict.ok ? 'info' : 'warn',
                taskId: subagentTaskId,
                requestId: parentRequestId,
                agentType,
                msg: verdict.ran
                  ? `doğrulama ${verdict.ok ? 'geçti' : 'başarısız'} (${verdict.checks
                      .map((check) => check.label)
                      .join(', ')})`
                  : `doğrulama çalıştırılamadı (${verdict.reason ?? 'bilinmiyor'})`,
                data: {
                  ran: verdict.ran,
                  ok: verdict.ok,
                  checks: verdict.checks.map((check) => ({
                    id: check.id,
                    ok: check.ok,
                    exitCode: check.exitCode
                  })),
                  durationMs: verdict.durationMs,
                  mutations: [...mutatedPaths].slice(0, 20)
                }
              })
              // Geçmediyse modeli geri gönder: hatayı görsün ve düzeltsin.
              if (
                verdict.ran &&
                !verdict.ok &&
                verifyRounds < MAX_VERIFY_ROUNDS &&
                step + 1 < MAX_STEPS
              ) {
                verifyRounds += 1
                // Modelin kendi kapanış metnini de geçmişe koy: aksi hâlde
                // "neyi düzelteceğim" sorusuna kendi raporunu görmeden yanıt verir.
                if ((result.content ?? '').trim()) {
                  messages.push({ role: 'assistant', content: result.content })
                }
                messages.push({ role: 'user', content: verifyRetryMessage(verdict) })
                logSubagent({
                  phase: 'verify',
                  level: 'warn',
                  taskId: subagentTaskId,
                  requestId: parentRequestId,
                  agentType,
                  msg: `doğrulama turu ${verifyRounds}/${MAX_VERIFY_ROUNDS} — model düzeltmeye gönderildi`
                })
                // Düzeltme turu adım bütçesinden çalmasın: bu turu geri al.
                step -= 1
                continue
              }
            } catch (error) {
              // Kapı çöktüyse "geçti" denmez.
              lastVerify = {
                ran: false,
                ok: false,
                summary:
                  'DOĞRULAMA: çalıştırılamadı (' +
                  (error instanceof Error ? error.message : String(error)) +
                  '). Değişiklikler **doğrulanmadı**.'
              }
            }
          }
        }
        const changed = readOnly ? '' : await changedFilesReport(changesBefore)
        logSubagent({
          phase: 'finish',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: 'alt ajan tamamlandı',
          data: {
            steps: step + 1,
            toolCalls: toolCallCount,
            elapsedMs: Date.now() - startedAt,
            contentLength: finalContent.length,
            verified: lastVerify?.ok,
            verifyRan: lastVerify?.ran
          }
        })
        // Doğrulama bloğu rapor bütçesinden SONRA eklenir: asla kesilmez.
        return {
          ok: true,
          content:
            applyReportBudget(
              (finalContent || 'Alt ajan bir sonuç üretmedi.') + changed
            ).text + (lastVerify ? `\n\n${lastVerify.summary}` : ''),
          ...(lastVerify ? { verified: lastVerify.ok, verify: lastVerify } : {})
        }
      }

      messages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments }
        }))
      })

      /** Bu adımda içerik üreten okuma sayısı (ilerleme ölçümü). */
      let productiveReadsThisStep = 0
      let coordinationThisStep = 0

      interface PreparedToolCall {
        call: (typeof result.toolCalls)[number]
        tool: NonNullable<ReturnType<typeof registry.get>>
        args: Record<string, unknown>
        checkpointId: string
      }
      /**
       * Hazırlanan çağrılar. İzin/onay **sıralı** olmak zorunda (kullanıcı
       * etkileşimi), ama onaylanmış salt-okunur çağrılar bağımsızdır.
       */
      const readyTools: PreparedToolCall[] = []

      for (const call of result.toolCalls) {
        if (controller.signal.aborted) {
          return { ok: false, content: 'Alt ajan durduruldu.' }
        }
        if (toolCallCount >= MAX_TOOL_CALLS) {
          logSubagent({
            phase: 'budget',
            level: 'warn',
            taskId: subagentTaskId,
            requestId: parentRequestId,
            agentType,
            msg: `araç bütçesi doldu (${MAX_TOOL_CALLS}) — sentez turuna geçiliyor`,
            data: { step, toolCalls: toolCallCount, elapsedMs: Date.now() - startedAt }
          })
          const synthesized = await finalizeSubagent({
            messages,
            request,
            baseUrl,
            apiKey,
            controller,
            tools: registry.definitions(),
            reason: 'tools'
          })
          const changedTools = readOnly ? '' : await changedFilesReport(changesBefore)
          logSubagent({
            phase: 'finish',
            level: 'warn',
            taskId: subagentTaskId,
            requestId: parentRequestId,
            agentType,
            msg: 'alt ajan kısmi sonuç döndürdü',
            data: { partialReason: 'tools', contentLength: synthesized.length }
          })
          return await finalizePartial(applyReportBudget(synthesized + changedTools).text, 'tools')
        }
        toolCallCount += 1
        onProgress?.({ step, toolCalls: toolCallCount, lastTool: call.name })

        // Araç çağrısını **yayınla**: önceden yalnızca sonuç gidiyordu, bu
        // yüzden arayüz alt ajanın ne yaptığını gösteremiyor ve testler
        // hangi araçların kullanıldığını gözleyemiyordu.
        send({
          requestId: parentRequestId,
          type: 'tool-call',
          call: {
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            agentType,
            subagentTaskId
          }
        })

        const tool = registry.get(call.name)
        if (!tool) {
          const content = unknownToolMessage(call.name, registry.names())
          logSubagent({
            phase: 'tool',
            level: 'warn',
            taskId: subagentTaskId,
            requestId: parentRequestId,
            agentType,
            msg: `bilinmeyen araç: ${call.name}`,
            data: { tool: call.name, available: registry.names().slice(0, 20) }
          })
          send({
            requestId: parentRequestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content, agentType, subagentTaskId }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
          continue
        }

        const args = parseArguments(call.arguments)
        const category = tool.category ?? toolCategory(call.name)
        const resource = permissionResource(call.name, args)
        const permission = resolvePermission(permissions, mode, profile, category, resource)
        if (permission === 'deny') {
          const content = `Alt ajan için izin verilmedi (${category}).`
          logSubagent({
            phase: 'tool',
            level: 'warn',
            taskId: subagentTaskId,
            requestId: parentRequestId,
            agentType,
            msg: `${call.name} izin politikası tarafından engellendi`,
            data: { tool: call.name, category, resource, mode, profile }
          })
          send({
            requestId: parentRequestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content, agentType, subagentTaskId }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
          continue
        }

        if (permission === 'ask') {
          let summary = call.name
          try {
            summary = tool.summary(args)
          } catch {
            summary = call.name
          }
          // Onay isteği ana istek kimliğiyle gönderilir; UI aynı onay kartını gösterir.
          const request: AgentApprovalRequest = {
            requestId: parentRequestId,
            toolCallId: call.id,
            name: call.name,
            summary: `[Alt ajan: ${agentType}] ${summary}`,
            category,
            args
          }
          const approved = options.approval
            ? await options.approval(request)
            : await (async () => {
                send({ requestId: parentRequestId, type: 'approval', request })
                return waitForApproval(approvalKey(parentRequestId, call.id), controller)
              })()
          if (!approved) {
            const content = 'Alt ajan eylemi kullanıcı tarafından reddedildi.'
            send({
              requestId: parentRequestId,
              type: 'tool-result',
              result: {
                toolCallId: call.id,
                name: call.name,
                ok: false,
                content,
                agentType,
                subagentTaskId
              }
            })
            messages.push({ role: 'tool', tool_call_id: call.id, content })
            continue
          }
        }

        readyTools.push({
          call,
          tool,
          args,
          checkpointId: `${parentRequestId}:sub:${toolCallCount}`
        })
      }

      // ---- Yürütme: salt-okunur çağrılar paralel ----
      // Canlı ölçüm: en yavaş alt ajanlar 20 adımda araçları **sırayla**
      // çalıştırıyordu; sürenin bir kısmı burada birikiyordu. Aynı
      // `toolRunner` mantığı alt ajana da uygulanır.
      const toolPerf = performanceProfile()
      const runPreparedTool = async (
        item: PreparedToolCall
      ): Promise<{
        ok: boolean
        content: string
        imageDataUrl?: string
        checkpointId?: string
        todos?: unknown
        durationMs: number
      }> => {
        const toolStartedAt = Date.now()
        // Kalan bütçeyi araç zaman aşımına yansıt: son tarihe 10 sn kalana
        // kadar araç çalışabilir, sonrası kesilir.
        const remaining = Math.max(5_000, deadlineMs() - (Date.now() - startedAt) - 10_000)
        try {
          const execution = await runToolWithTimeout(
            (signal) =>
              item.tool.execute(item.args, {
                requestId: parentRequestId,
                sessionId,
                send,
                checkpointId: item.checkpointId,
                signal
              }),
            controller.signal,
            Math.min(TOOL_TIMEOUT_MS, remaining)
          )
          logSubagent({
            phase: 'tool',
            level: execution.ok ? 'info' : 'warn',
            taskId: subagentTaskId,
            requestId: parentRequestId,
            agentType,
            msg: `${item.call.name} ${execution.ok ? 'ok' : 'başarısız'}`,
            data: {
              tool: item.call.name,
              ok: execution.ok,
              durationMs: Date.now() - toolStartedAt,
              timeoutMs: Math.min(TOOL_TIMEOUT_MS, remaining),
              resultLength: execution.content.length,
              error: execution.ok ? undefined : execution.content.slice(0, 300)
            }
          })
          return { ...execution, durationMs: Date.now() - toolStartedAt }
        } catch (error) {
          const content = `Alt ajan araç hatası: ${
            error instanceof Error ? error.message : String(error)
          }`
          logSubagent({
            phase: 'tool',
            level: 'error',
            taskId: subagentTaskId,
            requestId: parentRequestId,
            agentType,
            msg: `${item.call.name} araç hatası`,
            data: {
              tool: item.call.name,
              ok: false,
              durationMs: Date.now() - toolStartedAt,
              timeoutMs: TOOL_TIMEOUT_MS,
              error: error instanceof Error ? error.message : String(error)
            }
          })
          return { ok: false, content, durationMs: Date.now() - toolStartedAt }
        }
      }

      let toolExecutions: Awaited<ReturnType<typeof runPreparedTool>>[]
      if (
        shouldRunInParallel(
          readyTools.map((item) => ({ call: item.call })),
          toolPerf.toolParallelism
        )
      ) {
        const parallelStartedAt = Date.now()
        toolExecutions = await runWithConcurrency(
          readyTools,
          toolPerf.toolParallelism,
          runPreparedTool
        )
        logSubagent({
          phase: 'step',
          taskId: subagentTaskId,
          requestId: parentRequestId,
          agentType,
          msg: `paralel araç: ${readyTools.length} çağrı · ${toolPerf.toolParallelism} eşzamanlı`,
          data: { parallelMs: Date.now() - parallelStartedAt }
        })
      } else {
        toolExecutions = []
        for (const item of readyTools) toolExecutions.push(await runPreparedTool(item))
      }

      for (const [index, item] of readyTools.entries()) {
        const execution = toolExecutions[index]!
        // Sonucu yayınla. 0.4.13'e kadar alt ajan yalnızca `tool-call`
        // gönderiyordu; arayüz ve testler sonucu hiç göremiyordu. Bu,
        // dosya sahipliği ihlalinin görünmez kalmasına da yol açıyordu.
        send({
          requestId: parentRequestId,
          type: 'tool-result',
          result: {
            toolCallId: item.call.id,
            name: item.call.name,
            ok: execution.ok,
            content: execution.content,
            imageDataUrl: execution.imageDataUrl,
            checkpointId: execution.checkpointId,
            todos: execution.todos as never,
            agentType,
            subagentTaskId
          }
        })
        messages.push({
          role: 'tool',
          tool_call_id: item.call.id,
          // Araç çıktısını modele girerken kırp (OpenAI ToolOutputTrimmer
          // ilkesi). Alt ajanlarda `webfetch` 90+ KB dönebiliyor ve her
          // sonraki adımda yeniden gönderiliyordu — sürenin asıl kaynağı.
          content: isTrimmableTool(item.call.name)
            ? trimToolOutput(execution.content, {
                maxChars: toolPerf.maxToolOutputChars,
                label: item.call.name
              })
            : execution.content
        })
        // ---- Doğrulama kapısı izleme ----
        if (isMutatingTool(item.call.name) && execution.ok) {
          lastMutationAt = toolCallCount
          const target = typeof item.args['path'] === 'string' ? item.args['path'] : item.call.name
          mutatedPaths.add(target)
        }
        if (item.call.name === 'run_checks') {
          lastSelfCheck = { atToolCall: toolCallCount, ok: execution.ok, content: execution.content }
        }
        if (isProductiveRead(item.call.name, execution.ok, execution.content.length)) {
          productiveReadsThisStep += 1
        }
        if (isCoordinationProgress(item.call.name, execution.ok, execution.content.length)) {
          coordinationThisStep += 1
        }
      }

      // İlerlemesiz döngü koruması: birkaç adımdır yalnızca araç çağırıyorsa
      // metin yazmaya yönlendir. Aksi hâlde 20 adımı da araçla harcayıp
      // limite takılıyor (canlı koşuda tam olarak bu oldu).
      stepHistory.push({
        contentLength: (result.content ?? '').trim().length,
        tools: result.toolCalls.map((call) => call.name),
        productiveReads: productiveReadsThisStep,
        coordinationSignals: coordinationThisStep
      })
      if (shouldNudgeProgress(stepHistory, nudgesSent)) {
        nudgesSent += 1
        messages.push({ role: 'user', content: progressNudgeMessage(nudgesSent - 1) })
      }
    }

    // Adım limiti: boş sonuç döndürmek yerine sentez turu zorla.
    // Canlı koşuda 4 ajanın 4'ü de boş döndü; ana ajan hiçbir bulgu alamadı.
    logSubagent({
      phase: 'budget',
      level: 'warn',
      taskId: subagentTaskId,
      requestId: parentRequestId,
      agentType,
      msg: `adım bütçesi doldu (${MAX_STEPS}) — sentez turuna geçiliyor`,
      data: { toolCalls: toolCallCount, elapsedMs: Date.now() - startedAt }
    })
    const synthesized = await finalizeSubagent({
      messages,
      request,
      baseUrl,
      apiKey,
      controller,
      tools: registry.definitions(),
      reason: 'steps'
    })
    const changedSteps = readOnly ? '' : await changedFilesReport(changesBefore)
    logSubagent({
      phase: 'finish',
      level: 'warn',
      taskId: subagentTaskId,
      requestId: parentRequestId,
      agentType,
      msg: 'alt ajan kısmi sonuç döndürdü',
      data: { partialReason: 'steps', contentLength: synthesized.length }
    })
    return await finalizePartial(applyReportBudget(synthesized + changedSteps).text, 'steps')
  } catch (error) {
    // Beklenmeyen hata: yeniden fırlatmadan önce tanılama kaydı bırak.
    logSubagent({
      phase: 'error',
      level: 'error',
      taskId: subagentTaskId,
      requestId: parentRequestId,
      agentType,
      msg: 'alt ajan beklenmeyen hata ile sonlandı',
      data: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        toolCalls: toolCallCount,
        elapsedMs: Date.now() - startedAt
      }
    })
    throw error
  } finally {
    await registry.dispose()
  }
}
