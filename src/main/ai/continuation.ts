import type { ChatMessage, ChatUsage, ToolCallInfo } from '../../shared/types'
import { AiError, isInterruptedStream } from './error'
import { describeFailure } from '../retry'
import type { CompletionResult } from '../sse'

/**
 * Kesilen veya token limitine takılan yanıtı **kaldığı yerden devam
 * ettirme** — OpenCode `packages/core/src/session/runner/llm.ts` ile aynı.
 *
 * OpenCode iki durumda "retry" değil "continue" yapar:
 *
 *   1. Çıktı başladıktan sonra akış kesildi (`Outcome.Continue`)
 *      → sentetik kullanıcı mesajı: CONTINUE_AFTER_INCOMPLETE
 *   2. `finish === "length"` (`Outcome.OutputLimit`)
 *      → sentetik kullanıcı mesajı: CONTINUE_AFTER_OUTPUT_LIMIT
 *
 * Her ikisinde de o ana kadar üretilen metin korunur ve yeni tur onun
 * üzerine eklenir. Böylece kullanıcı yarım yanıtla kalmaz.
 */

/** OpenCode `CONTINUE_AFTER_INCOMPLETE_STREAM`. */
export const CONTINUE_AFTER_INCOMPLETE =
  'Önceki yanıt kesildi. Kaldığın yerden devam et; tamamlanmış içeriği tekrar etme.'

/** OpenCode `CONTINUE_AFTER_OUTPUT_LIMIT`. */
export const CONTINUE_AFTER_OUTPUT_LIMIT =
  'Son yanıtın çıktı token sınırına takıldı (bitiş nedeni: length). Özür dileme, özetleme, ' +
  'kendini tekrar etme. Kalan işi daha küçük parçalara böl.'

/** Sonsuz döngü koruması: en fazla bu kadar devam turu. */
export const MAX_CONTINUATIONS = 5

export interface ContinuationEvent {
  reason: 'interrupted' | 'output-limit'
  attempt: number
  soFar: number
  error?: string
}

export interface StreamWithContinuationInput {
  /** Konuşma geçmişi (bu turda değiştirilmez; kopya üzerinde çalışılır). */
  messages: ChatMessage[]
  /** Tek bir turu çalıştırır. */
  run: (messages: ChatMessage[]) => Promise<CompletionResult>
  /** Arayüze akan parçalar. */
  onDelta: (kind: 'content' | 'reasoning', text: string) => void
  signal: AbortSignal
  /** Devam turu başlarken. */
  onContinue?: (event: ContinuationEvent) => void
  maxContinuations?: number
  /** Devam öncesi bekleme (ms). */
  retryDelayMs?: number
}

export interface StreamWithContinuationResult {
  content: string
  reasoning: string
  toolCalls: ToolCallInfo[]
  usage?: ChatUsage
  finishReason: string | null
  continuations: number
  /** Devam mesajları dahil, modele gönderilen son mesaj listesi. */
  messages: ChatMessage[]
}

/** İptal edilebilir kısa bekleme. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/**
 * Yanıtı tamamlanana kadar sürdürür.
 * Yalnızca kurtarılamaz hata veya devam sınırı aşılırsa hata fırlatır.
 */
export async function streamWithContinuation(
  input: StreamWithContinuationInput
): Promise<StreamWithContinuationResult> {
  const limit = input.maxContinuations ?? MAX_CONTINUATIONS
  const messages: ChatMessage[] = [...input.messages]

  let content = ''
  let reasoning = ''
  let usage: ChatUsage | undefined
  let finishReason: string | null = null
  let toolCalls: ToolCallInfo[] = []
  let continuations = 0

  for (;;) {
    if (input.signal.aborted) {
      return { content, reasoning, toolCalls, usage, finishReason, continuations, messages }
    }

    try {
      const result = await input.run(messages)
      content += result.content
      reasoning += result.reasoning
      if (result.usage) usage = result.usage
      finishReason = result.finishReason
      toolCalls = result.toolCalls

      // Token limiti → OpenCode `OutputLimit`: devam ettir.
      if (result.finishReason === 'length' && continuations < limit) {
        continuations += 1
        input.onContinue?.({
          reason: 'output-limit',
          attempt: continuations,
          soFar: content.length
        })
        // Üretilen metni geçmişe yaz, devam talimatı ekle.
        if (result.content.trim()) {
          messages.push({ role: 'assistant', content: result.content })
        }
        messages.push({ role: 'user', content: CONTINUE_AFTER_OUTPUT_LIMIT })
        await delay(input.retryDelayMs ?? 0, input.signal)
        continue
      }

      return { content, reasoning, toolCalls, usage, finishReason, continuations, messages }
    } catch (caught) {
      const error =
        caught instanceof AiError
          ? caught
          : new AiError({
              tag: 'UnknownProvider',
              message: caught instanceof Error ? caught.message : String(caught)
            })

      if (input.signal.aborted) throw error

      // Kısmi çıktı + kesinti → OpenCode `Continue`.
      const interrupted = error.outputStarted && isInterruptedStream(error)
      if (!interrupted || continuations >= limit) throw error

      // O ana kadar akan metin zaten arayüzde; birikime ekle.
      if (error.partialContent) {
        content = error.partialContent
        reasoning = error.partialReasoning || reasoning
      }

      continuations += 1
      input.onContinue?.({
        reason: 'interrupted',
        attempt: continuations,
        soFar: content.length,
        error: describeFailure(error)
      })

      // Kısmi asistan mesajı geçmişe yaz ki model nerede kaldığını bilsin.
      if (content.trim()) {
        messages.push({ role: 'assistant', content })
      }
      messages.push({ role: 'user', content: CONTINUE_AFTER_INCOMPLETE })
      await delay(input.retryDelayMs ?? 1_000, input.signal)
    }
  }
}
