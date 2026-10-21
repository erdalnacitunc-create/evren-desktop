import type { ChatEvent, ChatRequest } from '../shared/types'

export function buildBaseBody(payload: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: payload.model,
    messages: payload.messages,
    stream: true
  }
  if (typeof payload.temperature === 'number') body.temperature = payload.temperature
  if (typeof payload.top_p === 'number') body.top_p = payload.top_p
  if (typeof payload.max_tokens === 'number') body.max_tokens = payload.max_tokens
  if (payload.reasoning_effort) body.reasoning_effort = payload.reasoning_effort
  if (typeof payload.thinking === 'boolean') body.thinking = payload.thinking
  return body
}

export function toErrorEvent(
  requestId: string,
  error: unknown,
  controller: AbortController
): ChatEvent {
  if (controller.signal.aborted) {
    return { requestId, type: 'done', finishReason: 'aborted' }
  }
  const status = (error as { status?: number })?.status
  const message = error instanceof Error ? error.message : String(error)
  return {
    requestId,
    type: 'error',
    error: message.slice(0, 600),
    status
  }
}
