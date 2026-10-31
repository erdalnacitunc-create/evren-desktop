import { buildBaseBody, toErrorEvent } from '../chatShared'
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
  ChatRequest
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

const MAX_STEPS = 20
const MAX_TOOL_CALLS = 40

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

  const executeSubagent = (
    agentType: 'explore' | 'review' | 'general',
    prompt: string,
    childController: AbortController
  ): Promise<{ ok: boolean; content: string }> =>
    runSubagent({
      parentRequestId: requestId,
      baseUrl,
      apiKey,
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
      if (!background) {
        const result = await executeSubagent(agentType, prompt, controller)
        return {
          ok: result.ok,
          content: `Alt ajan (${agentType}) sonucu:\n\n${result.content}`
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
  const skillSection =
    skills.length > 0
      ? `\n\nKullanılabilir beceriler:\n${skills
          .map((skill) => `- ${skill.name} [${skill.id}]: ${skill.description ?? ''}`)
          .join('\n')}\nBir becerinin talimatlarını yüklemek için "skill" aracını kullan.`
      : ''
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

  const systemIndex = messages.findIndex((message) => message.role === 'system')
  if (systemIndex >= 0) {
    const existing = messages[systemIndex]
    if (typeof existing.content === 'string') {
      existing.content += workspaceSection + planSection + todoSection + skillSection
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
        skillSection
    })
  }
  let toolCallCount = 0

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

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (controller.signal.aborted) {
        send({ requestId, type: 'done', finishReason: 'aborted' })
        return
      }

      if (step > 0) applySteering()

      const body = {
        ...buildBaseBody(payload),
        messages,
        tools: registry.definitions(),
        tool_choice: 'auto'
      }

      const result = await streamCompletion(
        baseUrl,
        apiKey,
        body,
        controller.signal,
        (delta) => send({ requestId, type: delta.kind, text: delta.text })
      )

      if (result.usage) send({ requestId, type: 'usage', usage: result.usage })

      if (result.toolCalls.length === 0) {
        // Araç çağrısı yok ama kullanıcı araya girdiyse yanıtı bitirme, devam et.
        if (applySteering(result.content ?? '')) continue
        send({ requestId, type: 'done', finishReason: result.finishReason })
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
          send({ requestId, type: 'done', finishReason: 'tool-limit' })
          return
        }
        toolCallCount += 1

        send({ requestId, type: 'tool-call', call })

        const tool = registry.get(call.name)
        if (!tool) {
          const content = `Bilinmeyen araç: ${call.name}`
          send({
            requestId,
            type: 'tool-result',
            result: { toolCallId: call.id, name: call.name, ok: false, content }
          })
          messages.push({ role: 'tool', tool_call_id: call.id, content })
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
    }

    send({ requestId, type: 'done', finishReason: 'max-steps' })
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
