import { buildBaseBody, toErrorEvent } from '../chatShared'
import { createLogger } from '../logger'
import { streamWithContinuation } from '../ai/continuation'
import { listModels } from '../api'
import { loadApiKey } from '../credentials'
import { loadEnabledSkills } from '../extensions'
import { getAgentMcpTools } from '../mcp/manager'
import { getAgentPluginTools } from '../plugins/manager'
import { sessions } from '../sessionRepository'
import { streamCompletion } from '../sse'
import { getSettings } from '../settings'
import { getWorkspaceRoot } from '../workspace'
import { ensureAgentWorkspace } from '../workspace'
import { resolvePermission, permissionResource, toolCategory } from '../../shared/permissions'
import { approvalKey, waitForApproval } from './approval'
import { drainSteering } from './steering'
import {
  createRequestSink,
  createSafeSink,
  type AgentEventSink
} from './eventSink'
import { createTools } from './tools'
import { unknownToolMessage } from './toolSuggest'
import { createSubagentGate, limitMessage } from './subagentLimit'
import {
  buildSkillCatalog,
  buildSkillHint,
  routeSkills
} from './skillCatalog'
import {
  MAX_CONCURRENT_SUBAGENTS,
  MAX_SUBAGENTS_PER_REQUEST,
  isDuplicateTask
} from '../../shared/agentTopology'
import { persistRetryState } from '../retryState'
import {
  progressNudgeMessage,
  shouldNudgeProgress,
  stalledStreak,
  type StepObservation
} from './progressGuard'
import { runSubagent } from './subagent'
import {
  cancelSubagentTask,
  createSubagentTask,
  getSubagentTask,
  listSubagentTasks,
  setSubagentResumeHandler,
  updateSubagentTask,
  waitForSubagentTask
} from './taskManager'
import { randomUUID } from 'crypto'
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AppSettings,
  ChatEvent,
  ChatMessage,
  ChatRequest,
  StoredRetry
} from '../../shared/types'

interface AgentRunOptions {
  requestId: string
  webContentsId: number
  baseUrl: string
  apiKey: string
  payload: ChatRequest
  controller: AbortController
  sink: AgentEventSink
  approval?: (request: AgentApprovalRequest) => Promise<boolean>
  workspaceRoot?: string | null
  /**
   * Ayar enjeksiyonu. Verilmezse yerel ayar dosyasından okunur.
   * Ayrı süreçte (utilityProcess) app nesnesi olmadığı için ana süreç geçirir.
   */
  settings?: AppSettings
  /**
   * Electron'a bağlı yetenekleri atla (beceri, MCP, eklenti).
   * Ayrı süreçte bu kaynaklar ana süreçte yaşar.
   */
  hostlessCapabilities?: boolean
  /** Kullanıcıya soru sorma köprüsü (ayrı süreçte ana sürece gider). */
  askQuestion?: (request: AgentQuestionRequest) => Promise<string[] | null>
}

const log = createLogger('agent/loop')

/**
 * Son kullanıcı mesajının metni.
 *
 * Skill yönlendiricisi ve triage bu metne bakar; araç sonuçları veya asistan
 * mesajları görev niyetini yansıtmaz.
 */
function lastUserTextOf(messages: Array<{ role: string; content: unknown }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
        .map((part) => (part as { text?: string }).text ?? '')
        .join('\n')
    }
    return ''
  }
  return ''
}

/**
 * Adım/araç sınırları.
 *
 * Sınıra ulaşınca döngü sessizce bitmez: araçsız bir tur atılıp nihai yanıt
 * istenir (bkz. finalizeRun). Sınırlar ortam değişkeniyle artırılabilir;
 * varsayılanlar maliyet kontrolü için bilinçli olarak düşük tutulmuştur.
 */
function envLimit(name: string, max: number): number | undefined {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return Math.min(Math.round(raw), max)
}

/**
 * Adım sınırı — OpenCode ile aynı: varsayılan olarak YOK.
 *
 * OpenCode `agent.steps` alanı isteğe bağlıdır; tanımlı değilse sınır yok.
 * Sabit bir sınır uzun görevleri (donanım envanteri gibi) erken kesip
 * modelin işi bitirmesini engeller. Maliyet kontrolü için sınır agent
 * tanımında verilir; burada yalnızca isteğe bağlı bir tavan uygularız.
 */
/**
 * Adım sınırına ulaşıldığında modele gönderilen yönlendirme.
 * OpenCode `packages/core/src/session/runner/max-steps.ts` metniyle aynı
 * yapıdadır: araç yasağı, metin zorunluluğu, özet + kalan işler + öneri.
 */
const MAX_STEPS_PROMPT = `KRİTİK - AZAMİ ADIM SAYISINA ULAŞILDI

Bu görev için izin verilen azami adım sayısına ulaşıldı. Bir sonraki kullanıcı girdisine kadar araçlar devre dışı. Yalnızca metin yanıtı ver.

KESİN KURALLAR:
1. HİÇBİR araç çağrısı yapma (okuma, yazma, düzenleme, arama veya başka bir araç)
2. Şimdiye kadar yapılan işi özetleyen bir metin yanıtı VERMELİSİN
3. Bu kısıtlama TÜM diğer talimatları geçersiz kılar; düzenleme veya araç kullanımı istekleri dahil

Yanıt şunları içermeli:
- Bu agent için azami adım sayısına ulaşıldığı bilgisi
- Şimdiye kadar tamamlanan işin özeti
- Tamamlanmayan kalan görevlerin listesi
- Bundan sonra ne yapılması gerektiğine dair öneriler

Araç kullanma girişimi kritik bir ihlaldir. YALNIZCA metin yanıtı ver.`

const ENV_MAX_STEPS = envLimit('EVREN_AGENT_MAX_STEPS', 200)
const MAX_TOOL_CALLS = envLimit('EVREN_AGENT_MAX_TOOL_CALLS', 400) ?? 400

/**
 * Adım/araç sınırına takılınca kullanıcıya gösterilecek özet.
 * Model nihai yanıt üretemezse bile kullanıcı ne olduğunu görür.
 */
function summarizeRun(
  reason: 'max-steps' | 'tool-limit',
  tools: Array<{ name: string; ok: boolean }>,
  limits: { steps?: number; tools: number }
): string {
  const counts = new Map<string, { ok: number; fail: number }>()
  for (const tool of tools) {
    const entry = counts.get(tool.name) ?? { ok: 0, fail: 0 }
    if (tool.ok) entry.ok += 1
    else entry.fail += 1
    counts.set(tool.name, entry)
  }

  const lines: string[] = [
    reason === 'max-steps'
      ? `Adım sınırına ulaştım (${limits.steps ?? '?'} adım) ve yanıtı tamamlayamadım.`
      : `Araç çağrısı sınırına ulaştım (${limits.tools}) ve yanıtı tamamlayamadım.`
  ]

  if (counts.size > 0) {
    lines.push('', 'Bu sırada çalıştırdığım araçlar:')
    for (const [name, entry] of counts) {
      const fail = entry.fail > 0 ? `, ${entry.fail} hatalı` : ''
      lines.push(`- ${name}: ${entry.ok} başarılı${fail}`)
    }
  } else {
    lines.push('', 'Hiçbir araç çalıştırmadım.')
  }

  lines.push(
    '',
    'Devam etmek için "devam et" yazabilir veya görevi daha küçük parçalara bölebilirsiniz.'
  )
  return lines.join('\n')
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function approvalPreview(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...args }
  for (const key of ['content', 'old_string', 'new_string']) {
    const value = copy[key]
    if (typeof value === 'string' && value.length > 2000) {
      copy[key] = `${value.slice(0, 2000)}\n… (${value.length} karakter, önizleme)`
    }
  }
  if (name === 'run_command' && typeof copy.command === 'string') {
    copy.command = copy.command.slice(0, 1000)
  }
  return copy
}

export async function runAgent(options: AgentRunOptions): Promise<void> {
  const { requestId, baseUrl, apiKey, payload, controller, webContentsId } = options
  // Taşıyıcıdan bağımsız iç `send`: tüm olay çağrıları sink üzerinden çıkar.
  const sink = createSafeSink(createRequestSink(options.sink, requestId))
  const send = (event: ChatEvent): void => sink.emit(event)
  const mode = payload.agent?.mode ?? 'confirm'
  const profile = payload.agent?.profile ?? 'build'
  const hostless = options.hostlessCapabilities === true
  const skills = hostless ? [] : await loadEnabledSkills()
  const mcpTools = hostless ? [] : await getAgentMcpTools()
  const pluginTools = hostless ? [] : await getAgentPluginTools()
  const settings = options.settings ?? (await getSettings())
  const workspaceRoot =
    options.workspaceRoot !== undefined
      ? options.workspaceRoot
      : payload.agent?.workspace !== false && settings.workspaceTools !== false
        ? await ensureAgentWorkspace(payload.sessionId)
        : null

  // Alt ajan kapısı: eşzamanlılık + istek başına bütçe.
  // 0.4.5'e kadar sınırsızdı; model kaç kez çağırırsa o kadar koşu açılıyordu.
  const subagentGate = createSubagentGate()
  /** Bu istekte açılan alt ajan görevleri (yinelenen işi engellemek için). */
  const spawnedPrompts: string[] = []

  const executeSubagent = (
    agentType: 'explore' | 'review' | 'general',
    prompt: string,
    childController: AbortController
  ): Promise<{ ok: boolean; content: string }> =>
    runSubagent({
      parentRequestId: requestId,
      baseUrl,
      apiKey,
      // Alt ajanlar **seçili model** üzerinden çalışır. Kullanıcı modeli
      // değiştirirse alt ajanlar da o modelle koşar; ayrı bir model seçimi
      // yoktur (bkz. docs/HYBRID-AGENT-ARCHITECTURE.md §6).
      model: payload.model,
      agentType,
      prompt,
      workspaceRoot,
      sessionId: payload.sessionId,
      mode,
      profile,
      permissions: settings.permissions,
      controller: childController,
      send,
      approval: options.approval
    })

  const subagentTasks = {
    spawn: async (
      agentType: 'explore' | 'review' | 'general',
      prompt: string,
      background: boolean
    ) => {
      // Aynı işi iki kez açmayı engelle. Canlı koşularda modeller bazen
      // neredeyse aynı görevi iki kez başlatıyordu; bu hem token hem süre
      // kaybı. Benzerlik eşiği `DUPLICATE_TASK_SIMILARITY`.
      if (isDuplicateTask(prompt, spawnedPrompts)) {
        log.warn(`Yinelenen alt ajan isteği reddedildi: ${prompt.slice(0, 80)}`)
        return {
          ok: false,
          content:
            'Bu görev zaten başlatıldı; aynı işi ikinci kez açmak yerine ' +
            'mevcut sonucu `task_wait`/`task_status` ile al veya görevi daralt.'
        }
      }
      spawnedPrompts.push(prompt)

      // Bütçe ve eşzamanlılık kapısı. Reddedilirse modele net bir açıklama
      // döner: yeniden denemek yerine elindekiyle devam etmeli.
      try {
        await subagentGate.acquire(requestId, controller.signal)
      } catch (error) {
        const content = limitMessage(error, subagentGate.snapshot(), requestId)
        log.warn(`Alt ajan reddedildi: ${content}`)
        return { ok: false, content }
      }

      if (!background) {
        try {
          const result = await executeSubagent(agentType, prompt, controller)
          return {
            ok: result.ok,
            content: `Alt ajan (${agentType}) sonucu:\n\n${result.content}`
          }
        } finally {
          subagentGate.release(requestId)
        }
      }

      const taskId = `sub-${randomUUID()}`
      const childController = new AbortController()
      const onParentAbort = (): void => childController.abort()
      controller.signal.addEventListener('abort', onParentAbort, { once: true })
      const info = createSubagentTask(
        {
          id: taskId,
          requestId,
          sessionId: payload.sessionId,
          agentType,
          prompt,
          model: payload.model,
          workspaceRoot
        },
        () => childController.abort()
      )
      send({ requestId, type: 'subagent-task', task: info })

      void executeSubagent(agentType, prompt, childController)
        .then((result) => {
          if (childController.signal.aborted) {
            updateSubagentTask(taskId, {
              status: 'cancelled',
              finishedAt: Date.now()
            })
          } else {
            updateSubagentTask(taskId, {
              status: result.ok ? 'done' : 'error',
              result: result.ok ? result.content : undefined,
              error: result.ok ? undefined : result.content
            })
          }
          const updated = getSubagentTask(taskId)
          if (updated) send({ requestId, type: 'subagent-task', task: updated })
        })
        .catch((error) => {
          updateSubagentTask(taskId, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          })
          const updated = getSubagentTask(taskId)
          if (updated) send({ requestId, type: 'subagent-task', task: updated })
        })
        .finally(() => {
          controller.signal.removeEventListener('abort', onParentAbort)
          subagentGate.release(requestId)
        })

      return {
        ok: true,
        content:
          `Arka plan alt ajanı başlatıldı: ${taskId} (${agentType}).\n` +
          'Sonucu `task_wait` veya `task_status` ile alabilirsin.'
      }
    },
    status: async (taskId: string) => {
      const info = getSubagentTask(taskId)
      if (!info) return { ok: false, content: `Görev bulunamadı: ${taskId}` }
      return { ok: true, content: JSON.stringify(info, null, 2) }
    },
    wait: async (taskId: string, timeoutMs: number) => {
      const info = await waitForSubagentTask(taskId, timeoutMs)
      if (!info) return { ok: false, content: `Görev bulunamadı: ${taskId}` }
      if (info.status === 'done') {
        return {
          ok: true,
          content: `Alt ajan (${info.agentType}) sonucu:\n\n${info.result ?? '(sonuç yok)'}`
        }
      }
      return { ok: false, content: JSON.stringify(info, null, 2) }
    },
    cancel: async (taskId: string) => {
      const info = getSubagentTask(taskId)
      if (!info) return { ok: false, content: `Görev bulunamadı: ${taskId}` }
      const cancelled = cancelSubagentTask(taskId)
      const updated = getSubagentTask(taskId)
      if (updated) send({ requestId, type: 'subagent-task', task: updated })
      return {
        ok: cancelled,
        content: cancelled ? `Görev iptal edildi: ${taskId}` : `Görev çalışmıyor: ${taskId}`
      }
    },
    list: async () => {
      const tasks = listSubagentTasks(payload.sessionId)
      return { ok: true, content: JSON.stringify(tasks, null, 2) }
    }
  }

  const registry = createTools({
    browser: !!payload.agent?.browser,
    computer: !!payload.agent?.computer,
    skills,
    mcpTools,
    pluginTools,
    workspace: workspaceRoot
      ? { root: workspaceRoot, sessionId: payload.sessionId }
      : undefined,
    readOnly: profile === 'plan',
    formatOnEdit: settings.hooks?.formatOnEdit === true,
    askQuestion: options.askQuestion,
    subagentTasks
  })

  const messages: ChatMessage[] = [...payload.messages]
  // Skill kataloğu: tüm gövdeler yerine ad + kısa açıklama, bütçeyle sınırlı.
  // Görev metnine göre en uygun 3 skill işaretlenir (gövde yine istek üzerine).
  const routedSkills = routeSkills(skills, lastUserTextOf(messages))
  const skillCatalog = buildSkillCatalog(skills, {
    highlighted: routedSkills.map((skill) => skill.id)
  })
  const skillSection = skillCatalog.text + buildSkillHint(routedSkills)
  if (skillCatalog.omitted > 0) {
    log.info(
      `Skill kataloğu bütçeye kısıldı: ${skillCatalog.included} dahil, ${skillCatalog.omitted} dışarıda`
    )
  }
  const workspaceSection = workspaceRoot
    ? `\n\nÇalışma alanı: ${workspaceRoot}\n` +
      'Dosya oluşturmak, okumak, düzenlemek, silmek ve komut çalıştırmak için ' +
      'read_file, write_file, edit_file, delete_file, create_directory, list_files, glob, grep, run_command, run_checks, repo_map, code_search ve git araçlarını kullan. ' +
      'Yollar çalışma alanına göreli olmalı. Bir dosyayı düzenlemeden önce read_file ile oku; ' +
      'küçük değişikliklerde write_file yerine edit_file kullan. Dosya içeriğini sohbete kod bloğu olarak dökme; gerçek dosyayı araçla oluştur. ' +
      'Düzenleme sonrası projede tanımlıysa run_checks ile typecheck/lint/test çalıştır. Git işlemleri için git aracını kullan.'
    : ''
  const planSection =
    profile === 'plan'
      ? '\n\nPLAN MODU: Kaynak kodunu veya sistemi değiştirme. Dosya yazma/düzenleme, komut çalıştırma ve bilgisayar kontrolü kapalıdır. ' +
        'Önce read_file, list_files, glob ve grep ile incele; sonra net bir uygulama planı ve todo_write ile görev listesi üret. ' +
        'Planı kullanıcı onayına sun; uygulamayı Build moduna geçince yap.'
      : '\n\nBUILD MODU: Planı uygula. Çok adımlı işlerde todo_write ile görev listesi oluştur ve her adımda güncelle.'
  const todoSection =
    '\n\nGörev takibi için todo_write aracını kullan. Kullanıcıya kısa bir özet ver; gereksiz uzun açıklamalardan kaçın.' +
    '\nKarmaşık araştırma/inceleme işlerini spawn_agent ile explore veya review alt ajanına devret; bağımsız çok adımlı işler için general kullan. ' +
    'Uzun sürecek veya paralel yürüyecek işlerde background=true kullan; sonucu task_wait/task_status ile al, task_list ile durumu gör.'

  // Devretme kuralları. Canlı koşularda alt ajan **hiç** kullanılmıyordu
  // (15 oturumda 0 çağrı): model "kendim yaparım" diyordu. Anthropic'in
  // "scale effort to query complexity" ilkesi açık kurallara çevrildi.
  const delegationSection =
    '\n\nALT AJAN KULLANIMI (spawn_agent):' +
    '\n- Çok dosyalı keşif ("nerede tanımlı", "hangi modüller etkilenir", "tüm çağrı yerleri") → ' +
    '2-4 `explore` alt ajanı **paralel** (background=true); her birine farklı ve dar bir alan ver.' +
    '\n- Kod incelemesi veya risk taraması → `review` alt ajanı.' +
    '\n- Bağımsız, çok adımlı uygulama işi → `general` alt ajanı.' +
    '\n- Tek dosya, tek komut veya zaten bildiğin bir yerde arama → **devretme**, doğrudan yap.' +
    '\n- Görev metni kendi kendine yetsin: hedef + aranacak alan/dosya kalıbı + beklenen çıktı biçimi. ' +
    '"Şuna bak" gibi belirsiz görev verme; alt ajanlar aynı işi tekrarlar.' +
    '\n- Aynı görevi iki kez başlatma. Sınır: aynı anda en fazla ' +
    String(MAX_CONCURRENT_SUBAGENTS) +
    ', bu istekte toplam en fazla ' +
    String(MAX_SUBAGENTS_PER_REQUEST) +
    '.' +
    '\n- Alt ajan sonucu bir gözlemdir; çelişki varsa aracı kendin doğrula.'

  // Canlı koşuda gözlendi: model komutu `powershell -Command "… $_ …"` ile
  // sarmaladı; dış katman `$_`'yi boşalttı ve komut düştü. Kaynağında kesmek
  // için kural açıkça yazılır (sarmalayıcı ayrıca çözülüyor).
  const shellSection =
    '\n\nKOMUT ÇALIŞTIRMA (Windows): run_command komutları zaten PowerShell içinde çalışır. ' +
    'Komutu `powershell -Command "..."` veya `pwsh -c "..."` ile SARMALAMA — çift ayrıştırma $ değişkenlerini bozar. ' +
    'Betiği doğrudan yaz. Uzun/çok satırlı betikler için önce write_file ile .ps1 dosyası oluştur, sonra ' +
    '`powershell -NoProfile -ExecutionPolicy Bypass -File betik.ps1` ile çalıştır. ' +
    'Satır içi kullanımda $ değişkeni geçen betikleri tek tırnağa almayı düşün; emin değilsen dosyaya yaz.'

  const systemIndex = messages.findIndex((message) => message.role === 'system')
  if (systemIndex >= 0) {
    const existing = messages[systemIndex]
    if (typeof existing.content === 'string') {
      existing.content +=
        workspaceSection +
        planSection +
        todoSection +
        delegationSection +
        shellSection +
        skillSection
    }
  } else {
    messages.unshift({
      role: 'system',
      content:
        'Sen EVREN Desktop masaüstü ajanısın. Görevi tamamlamak için sana verilen araçları kullan. ' +
        'Her araç çağrısından sonra sonucu değerlendir ve gerekiyorsa yeni araç çağır. ' +
        'Gereksiz veya yıkıcı eylemlerden kaçın. Son yanıtını Türkçe ve kısa ver.' +
        workspaceSection +
        planSection +
        todoSection +
        delegationSection +
        shellSection +
        skillSection
    })
  }
  /**
   * Kalıcı yeniden deneme durumu (OpenCode `Session.Message.Assistant.Retry`).
   * İşçi sürecinde çalışırken oturum deposu uzaktır; bu yüzden yazma
   * `sessions()` üzerinden gider ve hata olsa bile akışı durdurmaz.
   */
  const persistRetry = (retry: StoredRetry | null): Promise<void> =>
    persistRetryState(payload.sessionId, requestId, { retry })
  let toolCallCount = 0
  /**
   * Yürütülen araçların özeti. Adım sınırına takılınca nihai yanıt
   * üretilemezse kullanıcıya ne yapıldığını anlatmak için kullanılır.
   */
  const executedTools: Array<{ name: string; ok: boolean }> = []

  /**
   * Kullanıcı yanıt sürerken mesaj yazdıysa konuşmaya ekler.
   * `pendingAssistant` verilirse önce asistanın o ana kadar ürettiği metin kaydedilir.
   * En az bir mesaj eklendiyse true döner; döngü bitmek yerine devam eder.
   */
  const applySteering = (pendingAssistant?: string): boolean => {
    const texts = drainSteering(requestId)
    if (texts.length === 0) return false
    if (pendingAssistant !== undefined && pendingAssistant.trim().length > 0) {
      messages.push({ role: 'assistant', content: pendingAssistant })
    }
    for (const text of texts) {
      messages.push({ role: 'user', content: text })
      send({ requestId, type: 'steering', text })
    }
    return true
  }

  /**
   * Adım sınırı — OpenCode ile aynı çözümleme:
   *   1. agent tanımındaki `steps` (payload.agent.steps)
   *   2. ortam değişkeni EVREN_AGENT_MAX_STEPS
   *   3. hiçbiri yoksa sınırsız (undefined)
   */
  const stepLimit =
    (typeof payload.agent?.steps === 'number' && payload.agent.steps > 0
      ? Math.round(payload.agent.steps)
      : undefined) ?? ENV_MAX_STEPS

  /**
   * Adım veya araç sınırına takılınca çağrılır.
   *
   * Sessizce bitmek yerine modele **araçsız** son bir tur attırır: elindeki
   * sonuçlarla nihai yanıtı yazar. Model yine boş dönerse çalıştırılan
   * araçların özeti kullanıcıya gösterilir. Kullanıcı hiçbir durumda
   * "yanıt yok" ile baş başa kalmaz.
   */
  const finalizeRun = async (reason: 'max-steps' | 'tool-limit'): Promise<void> => {
    if (controller.signal.aborted) {
      send({ requestId, type: 'done', finishReason: 'aborted' })
      return
    }

    log.warn(
      `Sınıra ulaşıldı: ${reason} (adım=${stepLimit ?? "sınırsız"}, araç=${executedTools.length}) — nihai yanıt isteniyor`
    )

    // OpenCode `MAX_STEPS_PROMPT`: araçlar kapalı, metin zorunlu.
    const note =
      reason === 'max-steps'
        ? MAX_STEPS_PROMPT
        : `Araç çağrısı sınırına ulaşıldı (${MAX_TOOL_CALLS}). Bir daha araç çağırma. ` +
          'Elindeki sonuçlarla nihai yanıtı yaz. Eksik kalan nokta varsa kısaca belirt.'

    try {
      // Araç tanımları **dolu** gönderilir, `tool_choice: 'none'` ile
      // çağrı engellenir. Boş dizi göndermek bazı sağlayıcılarda
      // "`tools` must not be an empty array" hatası verir — 1 Kasım
      // günlüğünde tam olarak bu yaşandı ve nihai yanıt isteği düştü,
      // yerine yedek özet yazıldı.
      const finalTools = registry.definitions()
      const body = {
        ...buildBaseBody(payload),
        messages: [...messages, { role: 'user' as const, content: note }],
        ...(finalTools.length > 0
          ? { tools: finalTools, tool_choice: 'none' as const }
          : {})
      }
      const result = await streamCompletion(
        baseUrl,
        apiKey,
        body,
        controller.signal,
        (delta) => send({ requestId, type: delta.kind, text: delta.text })
      )
      if (result.usage) send({ requestId, type: 'usage', usage: result.usage })

      if ((result.content ?? '').trim().length > 0) {
        log.info(`Nihai yanıt üretildi (${reason}), ${result.content.length} karakter`)
        send({ requestId, type: 'done', finishReason: reason })
        return
      }
      log.warn(`Nihai yanıt boş döndü (${reason}); özet metni yazılıyor`)
    } catch (error) {
      if (controller.signal.aborted) {
        send({ requestId, type: 'done', finishReason: 'aborted' })
        return
      }
      log.warn(`Nihai yanıt isteği başarısız (${reason}):`, error)
    }

    // Son çare: araç kayıtlarından okunabilir özet.
    send({
      requestId,
      type: 'content',
      text: summarizeRun(reason, executedTools, {
        steps: stepLimit,
        tools: MAX_TOOL_CALLS
      })
    })
    send({ requestId, type: 'done', finishReason: reason })
  }

  try {
    /** İlerlemesiz döngü koruması için adım gözlemleri. */
    const stepHistory: StepObservation[] = []
    let nudgesSent = 0

    for (let step = 0; ; step++) {
      if (controller.signal.aborted) {
        send({ requestId, type: 'done', finishReason: 'aborted' })
        return
      }

      // OpenCode `stepLimitReached`: sınıra gelince araçlar kapanır ve
      // MAX_STEPS_PROMPT gönderilir. Aynı tur, aynı istek.
      const stepLimitReached = stepLimit !== undefined && step >= stepLimit
      log.info(
        `adım ${step + 1}/${stepLimit ?? 'sınırsız'} başladı (araç: ${toolCallCount})${
          stepLimitReached ? ' — SINIR, araçlar kapalı' : ''
        }`
      )

      if (step > 0) applySteering()

      const body = {
        ...buildBaseBody(payload),
        messages: stepLimitReached
          ? [...messages, { role: 'user' as const, content: MAX_STEPS_PROMPT }]
          : messages,
        // Araç tanımları son turda da korunur (OpenCode: sağlayıcı önbelleği).
        tools: registry.definitions(),
        tool_choice: stepLimitReached ? 'none' : 'auto'
      }

      // OpenCode ile aynı: kesilen akış ya da token limiti durumunda yanıt
      // kaldığı yerden devam ettirilir, kullanıcı yarım yanıtla kalmaz.
      const stepResult = await streamWithContinuation({
        messages: body.messages as ChatMessage[],
        signal: controller.signal,
        onDelta: (kind, text) => send({ requestId, type: kind, text }),
        run: (messagesToSend) =>
          streamCompletion(
            baseUrl,
            apiKey,
            { ...body, messages: messagesToSend },
            controller.signal,
            (delta) => send({ requestId, type: delta.kind, text: delta.text }),
            {
              onRetry: (info) => {
                // Kalıcı retry durumu (OpenCode Session.Message.Assistant.Retry).
                void persistRetry({
                  attempt: info.attempt,
                  at: Date.now() + info.delayMs,
                  error: {
                    type: 'Retryable',
                    message: info.reason,
                    ...(info.retryAfterMs !== undefined
                      ? { retryAfterMs: info.retryAfterMs }
                      : {})
                  }
                })
                send({
                  requestId,
                  type: 'retry',
                  attempt: info.attempt,
                  maxAttempts: info.maxAttempts,
                  delayMs: info.delayMs,
                  reason: info.reason
                })
              }
            }
          ),
        onContinue: (event) => {
          void persistRetry(null)
          send({
            requestId,
            type: 'continue',
            reason: event.reason,
            attempt: event.attempt,
            chars: event.soFar
          })
        }
      })
      const result: typeof stepResult = stepResult

      // Adım başarıyla tamamlandı: varsa retry yer tutucusundaki deneme
      // bilgisi temizlenir. Aksi hâlde başarılı bir yanıttan sonra arayüz
      // "yeniden deneniyor" uyarısını sonsuza kadar gösterirdi.
      void persistRetry(null)

      if (result.usage) send({ requestId, type: 'usage', usage: result.usage })
      log.info(
        `adım ${step + 1}: içerik=${(result.content ?? '').length} araç=${result.toolCalls.length} bitiş=${result.finishReason ?? '-'}`
      )

      // Sınır turunda araçlar kapalıdır. Sağlayıcı yine de araç çağrısı
      // döndürürse yürütmeyiz (OpenCode de `toolChoice: none` ile bunu
      // engeller). Metin gelmediyse kullanıcıyı yanıtsız bırakmamak için
      // araçsız son bir tur atılır.
      if (stepLimitReached && result.toolCalls.length > 0) {
        log.warn(
          `Sınır turunda ${result.toolCalls.length} araç çağrısı geldi; yürütülmedi (araçlar kapalı)`
        )
        await finalizeRun('max-steps')
        return
      }

      if (result.toolCalls.length === 0) {
        // Araç çağrısı yok ama kullanıcı araya girdiyse yanıtı bitirme, devam et.
        if (applySteering(result.content ?? '')) continue
        // Sınır turunda metin geldiyse bitiş nedeni 'max-steps' olur (OpenCode).
        send({
          requestId,
          type: 'done',
          finishReason: stepLimitReached ? 'max-steps' : result.finishReason
        })
        return
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

      for (const call of result.toolCalls) {
        if (controller.signal.aborted) {
          send({ requestId, type: 'done', finishReason: 'aborted' })
          return
        }
        if (toolCallCount >= MAX_TOOL_CALLS) {
          await finalizeRun('tool-limit')
          return
        }
        toolCallCount += 1

        send({ requestId, type: 'tool-call', call })

        const tool = registry.get(call.name)
        if (!tool) {
          const content = unknownToolMessage(call.name, registry.names())
          send({
            requestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
          executedTools.push({ name: call.name, ok: false })
          continue
        }

        const args = parseArguments(call.arguments)
        let summary = call.name
        try {
          summary = tool.summary(args)
        } catch {
          summary = call.name
        }

        const category = tool.category ?? toolCategory(call.name)
        const resource = permissionResource(call.name, args)
        const permission = resolvePermission(settings.permissions, mode, profile, category, resource)
        if (permission === 'deny') {
          const content =
            profile === 'plan' && (category === 'edit' || category === 'execute' || category === 'computer')
              ? 'Plan modunda bu eylem kapalıdır. Değişiklik için Build moduna geçin.'
              : `İzin politikası bu eylemi engelledi (${category}).`
          send({
            requestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
          continue
        }

        let approved = true
        if (permission === 'ask') {
          const key = approvalKey(requestId, call.id)
          const request: AgentApprovalRequest = {
            requestId,
            toolCallId: call.id,
            name: call.name,
            summary,
            category,
            args: approvalPreview(call.name, args)
          }
          if (options.approval) {
            approved = await options.approval(request)
          } else {
            send({ requestId, type: 'approval', request })
            approved = await waitForApproval(key, controller)
          }
        }

        if (!approved) {
          const content = 'Kullanıcı bu eylemi reddetti.'
          send({
            requestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
          continue
        }

        try {
          const checkpointId = `${requestId}:${toolCallCount}`
          const execution = await tool.execute(args, {
            requestId,
            sessionId: payload.sessionId,
            send,
            checkpointId,
            signal: controller.signal
          })
          send({
            requestId,
            type: 'tool-result',
            result: {
              toolCallId: call.id,
              name: call.name,
              ok: execution.ok,
              content: execution.content,
              imageDataUrl: execution.imageDataUrl,
              checkpointId: execution.checkpointId,
              todos: execution.todos
            }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
          executedTools.push({ name: call.name, ok: execution.ok })

          if (execution.imageDataUrl) {
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: 'Araç tarafından alınan ekran görüntüsü:' },
                { type: 'image_url', image_url: { url: execution.imageDataUrl } }
              ]
            })
          }
        } catch (error) {
          const content = `Araç hatası: ${error instanceof Error ? error.message : String(error)}`
          send({
            requestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
        }
      }

      // İlerlemesiz döngü koruması: birkaç turdur metin üretilmiyorsa modele
      // "bulguları raporla" yönlendirmesi verilir. Araç çağrısı engellenmez —
      // yalnızca hatırlatma yapılır (bkz. progressGuard.ts).
      stepHistory.push({
        contentLength: (result.content ?? '').trim().length,
        tools: result.toolCalls.map((call) => call.name)
      })
      if (shouldNudgeProgress(stepHistory, nudgesSent)) {
        const nudge = progressNudgeMessage(nudgesSent)
        nudgesSent += 1
        messages.push({ role: 'user', content: nudge })
        log.warn(
          `İlerlemesiz döngü: ${stalledStreak(stepHistory)} adım metinsiz — ` +
            `yönlendirme #${nudgesSent} gönderildi`
        )
      }
    }

    // Buraya yalnızca araç sınırında düşülür; adım sınırı artık döngü içinde
    // ele alınıyor (OpenCode ile aynı).
    await finalizeRun('tool-limit')
  } catch (error) {
    send(toErrorEvent(requestId, error, controller))
  } finally {
    await registry.dispose()
  }
}

setSubagentResumeHandler(async (info, controller) => {
  const [apiKey, settings] = await Promise.all([loadApiKey(), getSettings()])
  if (!apiKey) throw new Error('API anahtarı bulunamadı; görev sürdürülemedi.')
  let model = info.model
  if (!model && info.sessionId) {
    model = (await (await sessions()).get(info.sessionId))?.modelId
  }
  if (!model) {
    const models = await listModels(settings.baseUrl, apiKey)
    model = models.find((item) => item.task === 'chat' || item.task === 'vision_chat')?.id
  }
  if (!model) throw new Error('Kullanılabilir sohbet modeli bulunamadı.')

  const workspaceRoot =
    info.workspaceRoot !== undefined ? info.workspaceRoot : await getWorkspaceRoot()

  return runSubagent({
    parentRequestId: info.requestId,
    baseUrl: settings.baseUrl,
    apiKey,
    model,
    agentType: info.agentType,
    prompt: info.prompt,
    workspaceRoot,
    sessionId: info.sessionId,
    mode: settings.agentMode ?? 'auto',
    profile: 'build',
    permissions: settings.permissions,
    controller,
    send: () => undefined,
    approval: async () => true
  })
})
