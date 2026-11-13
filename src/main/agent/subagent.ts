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
  /** Görev kimliği: araç çağrılarını bu alt ajana atfetmek için. */
  subagentTaskId?: string
  /**
   * Bu ajanın yazabileceği yollar. Boşsa kısıt yok.
   * Doluysa araç düzeyinde zorlanır — liste dışına yazma reddedilir.
   */
  ownedFiles?: string[]
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
    'birlikte düzenli bir rapor olarak YAZ. Eksik kalan noktaları "doğrulanamadı" diye işaretle.'

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

  const outsideNote =
    workspaceRoot && /\b[A-Za-z]:\\/.test(prompt)
      ? '\n\nÇALIŞMA ALANI DIŞI: Görevdeki mutlak yollar çalışma alanının dışında olabilir. ' +
        'read_file/list_files/glob/grep yalnızca çalışma alanı içinde çalışır. ' +
        'Dışarıdaki dosyalar için **run_command** kullan ve **mutlak yol** ver ' +
        '(ör. Get-Content "C:\\proje\\dosya.md" -Encoding UTF8). ' +
        'read_file denemeyin.'
      : ''
  const efficiency =
    '\n\nVERİMLİLİK:' +
    '\n- Aynı adımda birden çok dosyayı oku: tek yanıtta birden fazla `read_file` çağrısı yap (paralel araç çağrısı). ' +
    'Dosyaları tek tek okumak adım bütçesini tüketir.' +
    '\n- Önce daralt: `grep`/`glob` ile ilgili dosyaları bul, sonra yalnızca gerekenleri oku.' +
    '\n- 5 adım içinde metin yazmaya başla; bulguları arada özetle.' +
    '\n- Rapor yazarken araç çağırma; elindekiyle bitir, eksikleri "doğrulanamadı" diye işaretle.'
  return `${base}${workspace}${ownershipNote}${scope}${outsideNote}${efficiency}\n\nGörev:\n${prompt}\n\nYalnızca ana ajana dönük kısa bir sonuç üret; kullanıcıya doğrudan hitap etme. Gereksiz araç çıktısını tekrar etme.`
}

export interface SubagentResult {
  ok: boolean
  content: string
  /** Sonuç eksik: bütçe/süre nedeniyle kesildi. */
  partial?: boolean
  partialReason?: 'steps' | 'tools' | 'deadline' | 'tool-timeout'
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
    ownedFiles
  } = options

  const skills = await loadEnabledSkills()
  const readOnly = agentType !== 'general' || profile === 'plan'
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
  const routedForCatalog = routeSkills(skills, prompt)
  const skillCatalog = buildSkillCatalog(skills, {
    highlighted: routedForCatalog.map((skill) => skill.id)
  })

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        agentInstruction(agentType, prompt, workspaceRoot, { readOnly, ownedFiles }) +
        skillCatalog.text +
        buildSkillHint(routedForCatalog)
    },
    { role: 'user', content: prompt }
  ]
  const request: ChatRequest = { model, messages }
  const startedAt = Date.now()
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
          reason: 'deadline'
        })
        const changedDeadline = readOnly ? '' : await changedFilesReport(changesBefore)
        return {
          ok: true,
          content: (synthesized + changedDeadline).slice(0, 12_000),
          partial: true,
          partialReason: 'deadline'
        }
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
        const changed = readOnly ? '' : await changedFilesReport(changesBefore)
        return {
          ok: true,
          content: ((finalContent || 'Alt ajan bir sonuç üretmedi.') + changed).slice(0, 12_000)
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
          const changedTools = readOnly ? '' : await changedFilesReport(changesBefore)
          return {
            ok: true,
            content: (synthesized + changedTools).slice(0, 12_000),
            partial: true,
            partialReason: 'tools'
          }
        }
        toolCallCount += 1

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

        try {
          // Kalan bütçeyi araç zaman aşımına yansıt: son tarihe 10 sn kalana
          // kadar araç çalışabilir, sonrası kesilir.
          const remaining = Math.max(
            5_000,
            DEADLINE_MS - (Date.now() - startedAt) - 10_000
          )
          const execution = await runToolWithTimeout(
            (signal) =>
              tool.execute(args, {
                requestId: parentRequestId,
                sessionId,
                send,
                checkpointId: `${parentRequestId}:sub:${toolCallCount}`,
                signal
              }),
            controller.signal,
            Math.min(TOOL_TIMEOUT_MS, remaining)
          )
          // Sonucu yayınla. 0.4.13'e kadar alt ajan yalnızca `tool-call`
          // gönderiyordu; arayüz ve testler sonucu hiç göremiyordu. Bu,
          // dosya sahipliği ihlalinin görünmez kalmasına da yol açıyordu.
          send({
            requestId: parentRequestId,
            type: 'tool-result',
            result: {
              toolCallId: call.id,
              name: call.name,
              ok: execution.ok,
              content: execution.content,
              imageDataUrl: execution.imageDataUrl,
              checkpointId: execution.checkpointId,
              todos: execution.todos,
              agentType,
              subagentTaskId
            }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
        } catch (error) {
          const content = `Alt ajan araç hatası: ${
            error instanceof Error ? error.message : String(error)
          }`
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
    const changedSteps = readOnly ? '' : await changedFilesReport(changesBefore)
    return {
      ok: true,
      content: (synthesized + changedSteps).slice(0, 12_000),
      partial: true,
      partialReason: 'steps'
    }
  } finally {
    await registry.dispose()
  }
}
