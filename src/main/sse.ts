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

/** Sağlayıcı veri göndermeyi durdurduğunda fırlatılır (yeniden denenebilir). */
class StreamIdleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamIdleError'
  }
}

/** Boşta kalma eşiği: EVREN_STREAM_IDLE_MS (varsayılan 60 sn). */
function envIdleMs(): number {
  const raw = Number(process.env['EVREN_STREAM_IDLE_MS'])
  if (!Number.isFinite(raw) || raw < 0) return 60_000
  return Math.min(Math.round(raw), 900_000)
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
      // Boşta kalan akışta uzun uzun beklemeyelim: en fazla 2 deneme.
      const attemptLimit =
        lastError instanceof StreamIdleError
          ? Math.min(policy.maxAttempts, 2)
          : policy.maxAttempts
      const isLast = attempt + 1 >= attemptLimit
      // Kısmi içerik aktıysa tekrar etmek metni çiftler; dur.
      const partial = (error as { partial?: boolean }).partial === true
      if (!retryable || isLast || partial) throw lastError

      const retryAfterMs =
        error instanceof StreamHttpError ? error.retryAfterMs : null
      const delayMs = nextDelay(attempt, retryAfterMs, policy)
      attempt += 1
      options.onRetry?.({
        attempt,
        maxAttempts: attemptLimit,
        delayMs,
        reason:
          lastError instanceof StreamIdleError
            ? 'Sunucu yanıt vermedi'
            : describeStatus(status)
      })
      await sleep(delayMs, signal)
    }
  }

  throw lastError ?? new Error('İstek tamamlanamadı')
}

/**
 * Boşta kalma koruması.
 *
 * Sağlayıcı bağlantıyı açıp hiç veri göndermezse istek sonsuza kadar
 * bekleyebilir (gerçek kullanımda iki paralel sekmede tam olarak bu oldu).
 * Her bayt geldiğinde sayaç sıfırlanır; süre dolarsa istek iptal edilir ve
 * yeniden deneme politikası devreye girer.
 */
function createIdleGuard(
  outer: AbortSignal,
  idleMs: number
): {
  signal: AbortSignal
  reset: () => void
  dispose: () => void
  idle: () => boolean
} {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | null = null
  let fired = false

  const onOuterAbort = (): void => controller.abort()

  const reset = (): void => {
    if (timer) clearTimeout(timer)
    if (idleMs <= 0) return
    timer = setTimeout(() => {
      fired = true
      controller.abort()
    }, idleMs)
  }

  if (outer.aborted) controller.abort()
  else outer.addEventListener('abort', onOuterAbort, { once: true })
  reset()

  return {
    signal: controller.signal,
    reset,
    idle: () => fired,
    dispose: () => {
      if (timer) clearTimeout(timer)
      timer = null
      outer.removeEventListener('abort', onOuterAbort)
    }
  }
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

  const idleMs = envIdleMs()
  const guard = createIdleGuard(signal, idleMs)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: guard.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
      body: JSON.stringify(body)
    })
  } catch (error) {
    guard.dispose()
    if (guard.idle()) {
      throw new StreamIdleError(
        `Sunucu ${Math.round(idleMs / 1000)} saniye boyunca veri göndermedi`
      )
    }
    throw error
  }

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
    let read: { done: boolean; value?: Uint8Array }
    try {
      read = await reader.read()
    } catch (error) {
      if (guard.idle()) {
        throw new StreamIdleError(
          `Yanıt akışı ${Math.round(idleMs / 1000)} saniye boyunca durdu`
        )
      }
      throw error
    }
    const { done, value } = read
    guard.reset()
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
        guard.dispose()
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
    guard.dispose()
    if (guard.idle() && !(error as { partial?: boolean }).partial) {
      // Boşta kalan akış yeniden denenebilir.
      throw new StreamIdleError(
        `Yanıt akışı ${Math.round(idleMs / 1000)} saniye boyunca durdu`
      )
    }
    // Kısmi içerik aktıysa yeniden denemek metni çiftler; işaretle.
    if (content.length > 0 || reasoning.length > 0) {
      ;(error as { partial?: boolean }).partial = true
    }
    throw error
  }

  guard.dispose()
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
