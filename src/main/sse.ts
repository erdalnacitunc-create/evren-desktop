import type { ChatUsage, ToolCallInfo } from '../shared/types'

export interface CompletionResult {
  content: string
  reasoning: string
  toolCalls: ToolCallInfo[]
  usage?: ChatUsage
  finishReason: string | null
}

export interface CompletionDelta {
  kind: 'content' | 'reasoning'
  text: string
}

export async function streamCompletion(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (delta: CompletionDelta) => void
): Promise<CompletionResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    let detail = ''
    try {
      const text = await res.text()
      try {
        const parsed = JSON.parse(text)
        detail = parsed?.detail ?? parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? text
      } catch {
        detail = text
      }
    } catch {
      // yut
    }
    const error = new Error(String(detail || `HTTP ${res.status}`).slice(0, 500)) as Error & {
      status?: number
    }
    error.status = res.status
    throw error
  }

  if (!res.body) throw new Error('Yanıt gövdesi yok.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  let content = ''
  let reasoning = ''
  let usage: ChatUsage | undefined
  let finishReason: string | null = null
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') {
        return { content, reasoning, toolCalls: finalizeTools(toolAcc), usage, finishReason }
      }

      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string
            reasoning?: string
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: string | null
        }>
        usage?: ChatUsage
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }

      const choice = chunk.choices?.[0]
      const delta = choice?.delta

      if (delta?.reasoning) {
        reasoning += delta.reasoning
        onDelta({ kind: 'reasoning', text: delta.reasoning })
      }
      if (delta?.content) {
        content += delta.content
        onDelta({ kind: 'content', text: delta.content })
      }
      for (const tc of delta?.tool_calls ?? []) {
        const index = tc.index ?? 0
        const current = toolAcc.get(index) ?? { id: '', name: '', args: '' }
        if (tc.id) current.id = tc.id
        if (tc.function?.name && !current.name) current.name = tc.function.name
        if (tc.function?.arguments) current.args += tc.function.arguments
        toolAcc.set(index, current)
      }
      if (chunk.usage) usage = chunk.usage
      if (choice?.finish_reason) finishReason = choice.finish_reason
    }
  }

  return { content, reasoning, toolCalls: finalizeTools(toolAcc), usage, finishReason }
}

function finalizeTools(
  toolAcc: Map<number, { id: string; name: string; args: string }>
): ToolCallInfo[] {
  return [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, value]) => value.name)
    .map(([index, value]) => ({
      id: value.id || `call_${index}`,
      name: value.name,
      arguments: value.args || '{}'
    }))
}
