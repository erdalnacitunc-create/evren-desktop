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
import { buildSkillCatalog, buildSkillHint, routeSkills } from './skillCatalog'
import {
  progressNudgeMessage,
  shouldNudgeProgress,
  type StepObservation
} from './progressGuard'

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
 * Yumuşak son tarih. Ana ajan çoğunlukla `task_wait` ile 240 sn bekler;
 * alt ajan bundan uzun sürerse ana ajan zaman aşımına uğrar (canlı koşuda
 * 4 ajan 5-6 dk sürdü, ilk `task_wait` boşa gitti). Süre dolunca ajan yeni
 * araç çağırmayı bırakıp elindeki bulguları yazar.
 */
const DEADLINE_MS = 210_000

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
async function finalizeSubagent(input: {
  messages: ChatMessage[]
  request: ChatRequest
  baseUrl: string
  apiKey: string
  controller: AbortController
  tools: unknown[]
  reason: 'steps' | 'tools'
}): Promise<string> {
  const note =
    input.reason === 'steps'
      ? 'Adım sınırına ulaştın. Yeni araç çağırma. Şimdiye kadar topladığın bulguları, ' +
        'dosya:satır referanslarıyla birlikte düzenli bir rapor olarak YAZ. ' +
        'Eksik kalan noktaları "doğrulanamadı" diye işaretle.'
      : 'Araç çağrısı sınırına ulaştın. Yeni araç çağırma. Elindeki bulguları ' +
        'dosya:satır referanslarıyla birlikte rapor olarak YAZ. Eksik kalanları belirt.'

  const body = {
    ...buildBaseBody(input.request),
    messages: [...input.messages, { role: 'user' as const, content: note }],
    ...(input.tools.length > 0
      ? { tools: input.tools, tool_choice: 'none' as const }
      : {})
  }

  try {
    const result = await streamCompletion(
      input.baseUrl,
      input.apiKey,
      body,
      input.controller.signal,
      () => undefined
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

function agentInstruction(type: SubagentType, prompt: string, workspaceRoot: string | null): string {
  const base =
    type === 'explore'
      ? 'Sen bir keşif alt ajanısın. Kod tabanını oku, ilgili dosyaları ve satırları bul, kanıtla birlikte kısa ve yoğun bir özet döndür. Dosya değiştirme.'
      : type === 'review'
        ? 'Sen bir kod inceleme alt ajanısın. Hataları, güvenlik risklerini, performans ve bakım sorunlarını incele. Dosya değiştirme; somut öneriler ve dosya:satır referansları ver.'
        : 'Sen bir genel görev alt ajanısın. Verilen görevi çalışma alanı araçlarıyla tamamla. Değişiklik yaparsan ne yaptığını ve sonucu özetle.'
  const workspace = workspaceRoot ? `\nÇalışma alanı: ${workspaceRoot}` : ''
  // Verimlilik kuralları. Canlı koşuda 4 explore ajanı 16 dosyayı tek tek
  // okumaya çalışıp adım limitine takıldı ve BOŞ sonuç döndürdü.
  const efficiency =
    '\n\nVERİMLİLİK:' +
    '\n- Aynı adımda birden çok dosyayı oku: tek yanıtta birden fazla `read_file` çağrısı yap (paralel araç çağrısı). ' +
    'Dosyaları tek tek okumak adım bütçesini tüketir.' +
    '\n- Önce daralt: `grep`/`glob` ile ilgili dosyaları bul, sonra yalnızca gerekenleri oku.' +
    '\n- 5 adım içinde metin yazmaya başla; bulguları arada özetle.' +
    '\n- Rapor yazarken araç çağırma; elindekiyle bitir, eksikleri "doğrulanamadı" diye işaretle.'
  return `${base}${workspace}${efficiency}\n\nGörev:\n${prompt}\n\nYalnızca ana ajana dönük kısa bir sonuç üret; kullanıcıya doğrudan hitap etme. Gereksiz araç çıktısını tekrar etme.`
}

export async function runSubagent(options: SubagentOptions): Promise<{
  ok: boolean
  content: string
}> {
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
    send
  } = options

  const skills = await loadEnabledSkills()
  const readOnly = agentType !== 'general' || profile === 'plan'
  const registry = createTools({
    browser: false,
    computer: false,
    skills,
    workspace: workspaceRoot ? { root: workspaceRoot, sessionId } : undefined,
    readOnly
  })

  // Alt ajana da skill kataloğu verilir; gövde yüklemez, yalnızca göreve
  // uygun olanları işaretler. Alt ajan "beceri var" bilgisiyle çalışır ama
  // bağlamı şişirmez.
  const routedForCatalog = routeSkills(skills, prompt)
  const skillCatalog = buildSkillCatalog(skills, {
    highlighted: routedForCatalog.map((skill) => skill.id)
  })

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        agentInstruction(agentType, prompt, workspaceRoot) +
        skillCatalog.text +
        buildSkillHint(routedForCatalog)
    },
    { role: 'user', content: prompt }
  ]
  const request: ChatRequest = { model, messages }
  const startedAt = Date.now()
  let toolCallCount = 0
  let finalContent = ''
  /** İlerlemesiz adım koruması: ana döngüdeki progressGuard'ın alt ajan sürümü. */
  const stepHistory: StepObservation[] = []
  let nudgesSent = 0

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (controller.signal.aborted) {
        return { ok: false, content: 'Alt ajan durduruldu.' }
      }
      // Yumuşak son tarih: ana ajanın task_wait süresinden önce bitir.
      if (Date.now() - startedAt > DEADLINE_MS) {
        const synthesized = await finalizeSubagent({
          messages,
          request,
          baseUrl,
          apiKey,
          controller,
          tools: registry.definitions(),
          reason: 'steps'
        })
        return { ok: true, content: synthesized.slice(0, 12_000) }
      }
      const body = {
        ...buildBaseBody(request),
        messages,
        tools: registry.definitions(),
        tool_choice: 'auto'
      }
      const result = await streamWithContinuation({
        messages: body.messages as ChatMessage[],
        signal: controller.signal,
        onDelta: () => undefined,
        run: (messagesToSend) =>
          streamCompletion(
            baseUrl,
            apiKey,
            { ...body, messages: messagesToSend },
            controller.signal,
            () => undefined
          )
      })
      if (result.content) finalContent = result.content

      if (result.toolCalls.length === 0) {
        return {
          ok: true,
          content: (finalContent || 'Alt ajan bir sonuç üretmedi.').slice(0, 12_000)
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

      for (const call of result.toolCalls) {
        if (controller.signal.aborted) {
          return { ok: false, content: 'Alt ajan durduruldu.' }
        }
        if (toolCallCount >= MAX_TOOL_CALLS) {
          const synthesized = await finalizeSubagent({
            messages,
            request,
            baseUrl,
            apiKey,
            controller,
            tools: registry.definitions(),
            reason: 'tools'
          })
          return { ok: true, content: synthesized.slice(0, 12_000) }
        }
        toolCallCount += 1

        const tool = registry.get(call.name)
        if (!tool) {
          const content = unknownToolMessage(call.name, registry.names())
          send({
            requestId: parentRequestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content }
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
            messages.push({ role: 'tool', tool_call_id: call.id, content })
            continue
          }
        }

        try {
          const execution = await tool.execute(args, {
            requestId: parentRequestId,
            send,
            checkpointId: `${parentRequestId}:sub:${toolCallCount}`
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
        } catch (error) {
          const content = `Alt ajan araç hatası: ${
            error instanceof Error ? error.message : String(error)
          }`
          messages.push({ role: 'tool', tool_call_id: call.id, content })
        }
      }

      // İlerlemesiz döngü koruması: birkaç adımdır yalnızca araç çağırıyorsa
      // metin yazmaya yönlendir. Aksi hâlde 20 adımı da araçla harcayıp
      // limite takılıyor (canlı koşuda tam olarak bu oldu).
      stepHistory.push({
        contentLength: (result.content ?? '').trim().length,
        tools: result.toolCalls.map((call) => call.name)
      })
      if (shouldNudgeProgress(stepHistory, nudgesSent)) {
        nudgesSent += 1
        messages.push({ role: 'user', content: progressNudgeMessage(nudgesSent - 1) })
      }
    }

    // Adım limiti: boş sonuç döndürmek yerine sentez turu zorla.
    // Canlı koşuda 4 ajanın 4'ü de boş döndü; ana ajan hiçbir bulgu alamadı.
    const synthesized = await finalizeSubagent({
      messages,
      request,
      baseUrl,
      apiKey,
      controller,
      tools: registry.definitions(),
      reason: 'steps'
    })
    return { ok: true, content: synthesized.slice(0, 12_000) }
  } finally {
    await registry.dispose()
  }
}
