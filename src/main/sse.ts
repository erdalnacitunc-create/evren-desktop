import type { ChatUsage, ToolCallInfo } from '../shared/types'
import { AiError, classifyFailure, isInterruptedStream, parseRetryAfter } from './ai/error'
import { RetryPolicy, describeFailure, sleep, type RetryOutcome } from './retry'

/**
 * SSE sohbet akışı.
 *
 * Zaman aşımı OpenCode `packages/ai/src/route/transport/http.ts` ile birebir
 * üç katmandır:
 *
 *   1. headerTimeout — başlıklar gelene kadar      (varsayılan 5 dk)
 *   2. chunkTimeout  — iki parça arası             (varsayılan 15 dk)
 *   3. totalTimeout  — istek başından sonuna       (varsayılan sınırsız)
 *
 * `chunkTimeout` neden 15 dakika? DeepSeek gibi sağlayıcılar model akıl
 * yürütürken dakikalarca hiçbir bayt göndermeyebilir; OpenCode bunu
 * belgelerinde açıkça yazar.
 *
 * Yeniden deneme de OpenCode `ModelRetry` ile aynıdır: yalnızca **görünür
 * çıktı başlamadan** şeffaf tekrar yapılır. Çıktı başladıysa tekrar etmek
 * metni çiftler; bunun yerine hata `outputStarted` ile yukarı iletilir ve
 * çağıran "devam ettir" kararı verir.
 */

/** OpenCode `DEFAULT_HTTP_TIMEOUT_MS`: başlıklar için 5 dakika. */
export const DEFAULT_HEADER_TIMEOUT_MS = 300_000
/**
 * OpenCode `DEFAULT_CHUNK_TIMEOUT_MS`: parçalar arası 15 dakika.
 * DeepSeek gibi sağlayıcılar akıl yürütürken dakikalarca sessiz kalabilir.
 */
export const DEFAULT_CHUNK_TIMEOUT_MS = 900_000

/** Ortam değişkeniyle eşik geçersiz kılma (işletim/test için). */
function envTimeout(name: string): number | undefined {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return Math.round(raw)
}

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

export interface RetryNotice {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: string
  /** Sunucunun istediği bekleme (varsa). */
  retryAfterMs?: number
}

export interface CompletionOptions {
  /** Şeffaf yeniden deneme bildirimi. */
  onRetry?: (info: RetryNotice) => void
  /** Hazır politika (testler). Verilmezse varsayılan oluşturulur. */
  policy?: RetryPolicy
  /** Zaman aşımı ayarları. */
  headerTimeoutMs?: number | false
  chunkTimeoutMs?: number | false
  totalTimeoutMs?: number | false
  /** Fazladan başlıklar (test enjeksiyonu için). */
  headers?: Record<string, string>
}

interface AttemptResult extends CompletionResult {
  /** Sağlayıcı `x-should-retry` başlığı gönderdi mi? */
  shouldRetryHeader?: string | null
}

function timeoutToMs(value: number | false | undefined, fallback: number): number {
  if (value === false) return 0 // 0 = sınırsız
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  return fallback
}

/** İptal edilebilir zamanlayıcı: her çağrıda sıfırlanır. */
function createTimer(ms: number, onFire: () => void): { reset: () => void; clear: () => void } {
  let handle: NodeJS.Timeout | null = null
  const clear = (): void => {
    if (handle) clearTimeout(handle)
    handle = null
  }
  const reset = (): void => {
    clear()
    if (ms <= 0) return
    handle = setTimeout(onFire, ms)
  }
  reset()
  return { reset, clear }
}

function abortError(): AiError {
  const error = new AiError({
    tag: 'Transport',
    message: 'İstek iptal edildi',
    operation: 'read',
    delivery: 'accepted',
    code: 'AbortError'
  })
  error.name = 'AbortError'
  return error
}

/**
 * Sohbet tamamlamasını akıtır; geçici hatalarda OpenCode politikasıyla
 * yeniden dener.
 */
export async function streamCompletion(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (delta: CompletionDelta) => void,
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const policy = options.policy ?? new RetryPolicy()
  let lastError: AiError | null = null

  for (;;) {
    if (signal.aborted) throw abortError()

    try {
      return await streamOnce(baseUrl, apiKey, body, signal, onDelta, options)
    } catch (caught) {
      const error =
        caught instanceof AiError
          ? caught
          : new AiError({
              tag: 'UnknownProvider',
              message: caught instanceof Error ? caught.message : String(caught)
            })
      lastError = error

      if (signal.aborted) throw abortError()

      // Görünür çıktı başladıysa şeffaf tekrar metni çiftler. Çağıran
      // "devam ettir" kararı verecek; hatayı kısmi içerikle iletiyoruz.
      if (error.outputStarted) throw error

      const decision: RetryOutcome = policy.decide(error, true, error.reason.tag === 'UnknownProvider' ? null : undefined)
      if (!decision.retry) {
        // Sınıflandırma yeniden denemeyi reddettiyse sebebi koru.
        throw error
      }

      options.onRetry?.({
        attempt: decision.attempt,
        maxAttempts: policy.attempts + 1,
        delayMs: decision.delayMs,
        reason: describeFailure(error),
        retryAfterMs: error.reason.retryAfterMs
      })

      await sleep(decision.delayMs, signal)
      if (signal.aborted) throw abortError()
    }
  }

  // unreachable
  throw lastError ?? new AiError({ tag: 'UnknownProvider', message: 'İstek tamamlanamadı' })
}

/** Tek bir deneme. Hata durumunda `AiError` fırlatır. */
async function streamOnce(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  outerSignal: AbortSignal,
  onDelta: (delta: CompletionDelta) => void,
  options: CompletionOptions
): Promise<AttemptResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  const headerMs = timeoutToMs(
    options.headerTimeoutMs,
    envTimeout('EVREN_STREAM_HEADER_TIMEOUT_MS') ?? DEFAULT_HEADER_TIMEOUT_MS
  )
  const chunkMs = timeoutToMs(
    options.chunkTimeoutMs,
    envTimeout('EVREN_STREAM_CHUNK_TIMEOUT_MS') ?? DEFAULT_CHUNK_TIMEOUT_MS
  )
  const totalMs = timeoutToMs(
    options.totalTimeoutMs,
    envTimeout('EVREN_STREAM_TOTAL_TIMEOUT_MS') ?? 0
  )

  // Deneme başına iptal denetleyicisi: dış iptal, başlık/parça/toplam
  // zaman aşımı hepsi bunu tetikler.
  const controller = new AbortController()
  const onOuterAbort = (): void => controller.abort()
  if (outerSignal.aborted) controller.abort()
  else outerSignal.addEventListener('abort', onOuterAbort, { once: true })

  // Kapanışlardan yazıldığı için nesne olarak tutulur; TS daraltması engellenir.
  const phaseState: { phase: 'header' | 'read' | 'total' } = { phase: 'header' }
  const headerTimer = createTimer(headerMs, () => {
    phaseState.phase = 'header'
    controller.abort()
  })
  const totalTimer = createTimer(totalMs, () => {
    phaseState.phase = 'total'
    controller.abort()
  })

  const cleanup = (): void => {
    headerTimer.clear()
    totalTimer.clear()
    outerSignal.removeEventListener('abort', onOuterAbort)
  }

  let started = false
  let outputStarted = false
  let content = ''
  let reasoning = ''

  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(options.headers ?? {})
        },
        body: JSON.stringify(body)
      })
    } catch (caught) {
      if (outerSignal.aborted) throw abortError()
      if (controller.signal.aborted && phaseState.phase === 'header') {
        throw new AiError({
          tag: 'Timeout',
          message: 'Yanıt başlıkları zaman aşımına uğradı',
          operation: 'request'
        })
      }
      if (controller.signal.aborted && phaseState.phase === 'total') {
        throw new AiError({
          tag: 'Timeout',
          message: 'İstek toplam süresi aşıldı',
          operation: 'read'
        })
      }
      const code = (caught as { cause?: { code?: string } })?.cause?.code
      throw classifyFailure({
        message: caught instanceof Error ? caught.message : String(caught),
        code,
        operation: 'request',
        delivery: 'not-sent'
      })
    }

    started = true
    headerTimer.clear()

    const shouldRetryHeader = res.headers.get('x-should-retry')
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))

    if (!res.ok) {
      let detail = ''
      try {
        const text = await res.text()
        try {
          const parsed = JSON.parse(text)
          detail =
            parsed?.detail ?? parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? text
        } catch {
          detail = text
        }
      } catch {
        // gövde okunamadı
      }
      throw classifyFailure({
        status: res.status,
        message: String(detail || `HTTP ${res.status}`).slice(0, 500),
        body: String(detail),
        retryAfterMs,
        shouldRetryHeader,
        operation: 'request',
        delivery: 'rejected'
      })
    }

    if (!res.body) {
      throw new AiError({
        tag: 'InvalidProviderOutput',
        message: 'Yanıt gövdesi yok',
        classification: 'incomplete-stream'
      })
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usage: ChatUsage | undefined
    let finishReason: string | null = null
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()

    // Parça zaman aşımı: her okumada sıfırlanır.
    const chunkTimer = createTimer(chunkMs, () => {
      phaseState.phase = 'read'
      controller.abort()
    })

    while (true) {
      let read: { done: boolean; value?: Uint8Array }
      try {
        read = await reader.read()
      } catch (caught) {
        if (outerSignal.aborted) throw abortError()
        if (controller.signal.aborted && phaseState.phase === 'read') {
          const error = new AiError({
            tag: 'Transport',
            message: `Yanıt akışı ${Math.round(chunkMs / 1000)} saniye boyunca durdu`,
            operation: 'read',
            delivery: 'accepted',
            code: 'Timeout'
          })
          error.outputStarted = outputStarted
          error.partialContent = content
          error.partialReasoning = reasoning
          throw error
        }
        if (controller.signal.aborted && phaseState.phase === 'total') {
          const error = new AiError({
            tag: 'Timeout',
            message: 'İstek toplam süresi aşıldı',
            operation: 'read'
          })
          error.outputStarted = outputStarted
          error.partialContent = content
          error.partialReasoning = reasoning
          throw error
        }
        const code = (caught as { cause?: { code?: string } })?.cause?.code
        const error = classifyFailure({
          message: caught instanceof Error ? caught.message : String(caught),
          code,
          operation: 'read',
          delivery: 'accepted'
        })
        error.outputStarted = outputStarted
        error.partialContent = content
        error.partialReasoning = reasoning
        throw error
      }

      const { done, value } = read
      chunkTimer.reset()
      if (done) break
      if (!value) continue

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          chunkTimer.clear()
          return {
            content,
            reasoning,
            toolCalls: finalizeTools(toolAcc),
            usage,
            finishReason,
            shouldRetryHeader
          }
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
          // OpenCode `reasoning-start` da outputStarted sayar.
          outputStarted = true
          onDelta({ kind: 'reasoning', text: delta.reasoning })
        }
        if (delta?.content) {
          content += delta.content
          outputStarted = true
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

    chunkTimer.clear()

    // Akış bitti ama bitiş nedeni yok: eksik akış sayılır (OpenCode `unknownFinish`).
    if (finishReason === null) {
      const error = new AiError({
        tag: 'InvalidProviderOutput',
        message: 'Sağlayıcı yanıtı bitiş nedeni olmadan sona erdi',
        classification: 'incomplete-stream'
      })
      error.outputStarted = outputStarted
      error.partialContent = content
      error.partialReasoning = reasoning
      throw error
    }

    return {
      content,
      reasoning,
      toolCalls: finalizeTools(toolAcc),
      usage,
      finishReason,
      shouldRetryHeader
    }
  } finally {
    cleanup()
    if (!started) {
      // hiçbir şey okunmadı
    }
  }
}

function finalizeTools(
  toolAcc: Map<number, { id: string; name: string; args: string }>
): ToolCallInfo[] {
  const calls: ToolCallInfo[] = []
  for (const [, value] of toolAcc) {
    if (!value.name) continue
    calls.push({
      id: value.id || `call-${calls.length}`,
      name: value.name,
      arguments: value.args || '{}'
    })
  }
  return calls
}

/** Bir hatanın "devam ettirilebilir" olup olmadığını söyler. */
export function canContinue(error: AiError): boolean {
  return error.outputStarted && isInterruptedStream(error)
}
