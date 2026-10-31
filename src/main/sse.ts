import type { ChatUsage, ToolCallInfo } from '../shared/types'
import {
  DEFAULT_RETRY_POLICY,
  describeStatus,
  isRetryable,
  nextDelay,
  sleep,
  type RetryPolicy
} from './retry'

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

export interface CompletionOptions {
  /**
   * Geçici hatada yeniden deneme bilgisi.
   * `attempt` 1 tabanlıdır (ilk yeniden deneme = 1).
   */
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void
  policy?: RetryPolicy
}

class StreamHttpError extends Error {
  status?: number
  retryAfterMs: number | null
  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Sohbet tamamlamasını akıtır.
 *
 * Geçici hatalarda (429/5xx/ağ) **henüz içerik akmamışsa** otomatik yeniden
 * dener; böylece kullanıcı "durdu" yerine devam eden yanıt görür. Kısmi
 * içerik aktıktan sonra kopan bağlantı yeniden denenmez (tekrar/çift metin
 * riski); o durumda hata yukarı iletilir.
 */
export async function streamCompletion(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (delta: CompletionDelta) => void,
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY
  let attempt = 0
  let lastError: StreamHttpError | Error | null = null

  while (attempt < policy.maxAttempts) {
    if (signal.aborted) throw abortError()
    try {
      return await streamOnce(baseUrl, apiKey, body, signal, onDelta)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const status = (error as { status?: number }).status
      const retryable = isRetryable({ status, aborted: signal.aborted })
      const isLast = attempt + 1 >= policy.maxAttempts
      // Kısmi içerik aktıysa tekrar etmek metni çiftler; dur.
      const partial = (error as { partial?: boolean }).partial === true
      if (!retryable || isLast || partial) throw lastError

      const retryAfterMs =
        error instanceof StreamHttpError ? error.retryAfterMs : null
      const delayMs = nextDelay(attempt, retryAfterMs, policy)
      attempt += 1
      options.onRetry?.({
        attempt,
        maxAttempts: policy.maxAttempts,
        delayMs,
        reason: describeStatus(status)
      })
      await sleep(delayMs, signal)
    }
  }

  throw lastError ?? new Error('İstek tamamlanamadı')
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null
  const text = value.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, 120_000)
  const date = Date.parse(text)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.min(date - Date.now(), 120_000))
}

function abortError(): Error {
  const error = new Error('İstek iptal edildi') as Error & { status?: number }
  error.name = 'AbortError'
  return error
}

async function streamOnce(
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
    throw new StreamHttpError(
      String(detail || `HTTP ${res.status}`).slice(0, 500),
      res.status,
      parseRetryAfterHeader(res.headers.get('retry-after'))
    )
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

  try {
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

  } catch (error) {
    // Kısmi içerik aktıysa yeniden denemek metni çiftler; işaretle.
    if (content.length > 0 || reasoning.length > 0) {
      ;(error as { partial?: boolean }).partial = true
    }
    throw error
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
