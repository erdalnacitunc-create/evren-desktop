import { buildBaseBody, toErrorEvent } from './chatShared'
import { streamCompletion } from './sse'
import {
  createRequestSink,
  createSafeSink,
  type AgentEventSink
} from './agent/eventSink'
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  MultiverseMemberResult
} from '../shared/types'

interface MultiverseRunOptions {
  requestId: string
  baseUrl: string
  apiKey: string
  payload: ChatRequest
  controller: AbortController
  sink: AgentEventSink
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text?: string }).text ?? '')
    .join('\n')
}

function lastUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return textOf(messages[index].content)
  }
  return ''
}

function extractContent(message: unknown): string {
  const value = message as {
    content?: unknown
    reasoning?: unknown
  }
  if (typeof value?.content === 'string' && value.content.trim()) return value.content
  if (Array.isArray(value?.content)) {
    const text = (value.content as Array<{ type?: string; text?: string }>)
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    if (text.trim()) return text
  }
  if (typeof value?.reasoning === 'string') return value.reasoning
  return ''
}

async function callMember(
  member: string,
  baseUrl: string,
  apiKey: string,
  payload: ChatRequest,
  signal: AbortSignal
): Promise<MultiverseMemberResult> {
  const maxTokens = Math.max(64, Math.min(1024, payload.max_tokens ?? 1024))
  const body: Record<string, unknown> = {
    model: member,
    messages: payload.messages,
    stream: false,
    max_tokens: maxTokens
  }
  if (typeof payload.temperature === 'number') body.temperature = payload.temperature
  if (typeof payload.top_p === 'number') body.top_p = payload.top_p

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 300)
      } catch {
        // yut
      }
      return {
        modelId: member,
        ok: false,
        error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      }
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: unknown }>
      usage?: MultiverseMemberResult['usage']
    }
    const content = extractContent(json.choices?.[0]?.message)
    if (!content.trim()) {
      return { modelId: member, ok: false, error: 'Boş yanıt.' }
    }
    return { modelId: member, ok: true, content, usage: json.usage }
  } catch (error) {
    return {
      modelId: member,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift() as T
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function buildSynthesisMessages(
  payload: ChatRequest,
  results: MultiverseMemberResult[]
): ChatMessage[] {
  const prompt = lastUserText(payload.messages)
  const answers = results
    .map(
      (result) =>
        `### ${result.modelId}\n${(result.content ?? '').slice(0, 6000)}`
    )
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        'Sen EVREN Çoklu Evren sentez modelisin. Aynı soruya farklı modellerin verdiği ' +
        'yanıtları karşılaştırır, çelişkileri belirler, doğru ve eksiksiz olanı seçer ve ' +
        'tek bir nihai yanıt üretirsin. Gereksiz model adı anmadan, kullanıcının dilinde ' +
        'net ve uygulanabilir bir yanıt ver. Yanıtlar çelişiyorsa hangisinin neden daha ' +
        'güvenilir olduğunu kısaca belirt.'
    },
    {
      role: 'user',
      content:
        `Orijinal istek:\n${prompt}\n\n` +
        `Farklı modellerin yanıtları:\n${answers}\n\n` +
        'Görev: Bu yanıtları sentezleyerek tek bir nihai yanıt üret.'
    }
  ]
}

export async function runMultiverse(options: MultiverseRunOptions): Promise<void> {
  const { requestId, baseUrl, apiKey, payload, controller } = options
  const sink = createSafeSink(createRequestSink(options.sink, requestId))
  const send = (event: ChatEvent): void => sink.emit(event)

  const primary = payload.model
  const members = [...new Set(payload.multiverse?.members ?? [])].filter(
    (member) => member && member !== primary
  )

  if (members.length === 0) {
    send({
      requestId,
      type: 'error',
      error: 'Çoklu Evren için uygun üye model bulunamadı.'
    })
    return
  }

  send({ requestId, type: 'multiverse-start', members })

  const results: MultiverseMemberResult[] = []

  try {
    await runPool(members, 3, async (member) => {
      if (controller.signal.aborted) return
      const result = await callMember(member, baseUrl, apiKey, payload, controller.signal)
      results.push(result)
      send({ requestId, type: 'multiverse-member', result })
    })

    if (controller.signal.aborted) {
      send({ requestId, type: 'done', finishReason: 'aborted' })
      return
    }

    const successful = results.filter((result) => result.ok && result.content)
    if (successful.length === 0) {
      send({
        requestId,
        type: 'error',
        error: 'Çoklu Evren: tüm üye modeller başarısız oldu.'
      })
      return
    }

    send({
      requestId,
      type: 'multiverse-synthesis',
      candidateCount: successful.length
    })

    const synthesisMessages = buildSynthesisMessages(payload, successful)
    const body = buildBaseBody({
      ...payload,
      messages: synthesisMessages,
      agent: undefined,
      multiverse: undefined
    })

    const result = await streamCompletion(
      baseUrl,
      apiKey,
      body,
      controller.signal,
      (delta) => send({ requestId, type: delta.kind, text: delta.text })
    )

    if (result.usage) send({ requestId, type: 'usage', usage: result.usage })

    if (!result.content.trim()) {
      send({
        requestId,
        type: 'error',
        error:
          result.finishReason === 'length'
            ? 'Sentez yanıtı token sınırına takıldı. Maks. çıktı token değerini artırın.'
            : 'Sentez boş yanıt döndü.'
      })
      return
    }

    send({ requestId, type: 'done', finishReason: result.finishReason })
  } catch (error) {
    send(toErrorEvent(requestId, error, controller))
  }
}
