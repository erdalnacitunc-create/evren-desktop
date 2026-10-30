import { buildBaseBody } from '../chatShared'
import { loadEnabledSkills } from '../extensions'
import { streamCompletion } from '../sse'
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

const MAX_STEPS = 10
const MAX_TOOL_CALLS = 20

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
  return `${base}${workspace}\n\nGörev:\n${prompt}\n\nYalnızca ana ajana dönük kısa bir sonuç üret; kullanıcıya doğrudan hitap etme. Gereksiz araç çıktısını tekrar etme.`
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

  const messages: ChatMessage[] = [
    { role: 'system', content: agentInstruction(agentType, prompt, workspaceRoot) },
    { role: 'user', content: prompt }
  ]
  const request: ChatRequest = { model, messages }
  let toolCallCount = 0
  let finalContent = ''

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (controller.signal.aborted) {
        return { ok: false, content: 'Alt ajan durduruldu.' }
      }
      const body = {
        ...buildBaseBody(request),
        messages,
        tools: registry.definitions(),
        tool_choice: 'auto'
      }
      const result = await streamCompletion(
        baseUrl,
        apiKey,
        body,
        controller.signal,
        () => undefined
      )
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
          return {
            ok: true,
            content: `Alt ajan araç limitine ulaştı.\n\n${finalContent}`.slice(0, 12_000)
          }
        }
        toolCallCount += 1

        const tool = registry.get(call.name)
        if (!tool) {
          const content = `Bilinmeyen araç: ${call.name}`
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
    }

    return {
      ok: true,
      content: `Alt ajan adım limitine ulaştı.\n\n${finalContent}`.slice(0, 12_000)
    }
  } finally {
    await registry.dispose()
  }
}
