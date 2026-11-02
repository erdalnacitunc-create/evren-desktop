import { webContents } from 'electron'
import { ApiError } from './api'
import { runAgent } from './agent/loop'
import { runMultiverse } from './multiverse'
import { rejectAllForRequest } from './agent/approval'
import { rejectAllQuestions } from './agent/question'
import {
  clearSteering,
  countSteering,
  pushSteering
} from './agent/steering'
import { loadApiKey } from './credentials'
import { getSettings } from './settings'
import {
  ensureAgentWorkspace,
  getWorkspaceRoot,
  runWithWorkspace
} from './workspace'
import { sessions } from './sessionRepository'
import { buildMemoryContext } from './memory/retrieve'
import { streamCompletion } from './sse'
import { buildBaseBody, toErrorEvent } from './chatShared'
import type {
  AppSettings,
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ChatUsage,
  StoredRetry
} from '../shared/types'
import {
  applyStreamEvent,
  belongsToRequest,
  emptyStreamState,
  type StreamState
} from './chatStreamTracker'
import { asSink, type AgentEventSink } from './agent/eventSink'
import { agentProcess } from './agent/process'
import { createLogger } from './logger'
import { appendSessionEvent, nextSeq } from './sessionEvents'
import { dropEmptyPlaceholder, persistRetryState } from './retryState'
import { streamWithContinuation } from './ai/continuation'

const controllers = new Map<string, AbortController>()
/**
 * Araya girme (steering) yalnızca ajan döngüsü çalışırken desteklenir.
 * Düz akışlarda mesaj kaybolmasın diye burada işaretlenir.
 */
const steerable = new Set<string>()
/** İşçi sürecinde çalışan istekler (iptal/steering yönlendirmesi için). */
const workerRequests = new Set<string>()

/**
 * Ajanı ayrı süreçte çalıştırma anahtarı.
 * `EVREN_AGENT_PROCESS=worker` → işçi; aksi halde ana süreç (varsayılan).
 * Tek ortam değişkeniyle geri alınabilir olması bilinçli bir güvenlik ağıdır.
 */
export function useWorkerForAgent(): boolean {
  return (process.env['EVREN_AGENT_PROCESS'] ?? '').toLowerCase() === 'worker'
}

/**
 * Ajanı işçide koşturur ve hata durumunu kullanıcıya olay olarak iletir.
 * Çökme sessiz kalmaz: `error` olayı renderer'a düşer.
 */
async function runAgentInWorker(input: {
  requestId: string
  baseUrl: string
  apiKey: string
  payload: ChatRequest
  settings: AppSettings
  workspaceRoot: string | null
  sink: AgentEventSink
  controller: AbortController
}): Promise<void> {
  const log = createLogger('chat/worker')
  try {
    const result = await agentProcess().runAgentInWorker(
      {
        requestId: input.requestId,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        payload: input.payload,
        settings: input.settings,
        workspaceRoot: input.workspaceRoot
      },
      input.sink
    )
    if (!result.ok) log.warn(`Ajan işçisi hata döndürdü: ${result.error ?? 'bilinmiyor'}`)
    if (!result.ok && !input.controller.signal.aborted) {
      input.sink.emit({
        requestId: input.requestId,
        type: 'error',
        error: result.error ?? 'Ajan süreci hatası'
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(`Ajan süreci kullanılamadı: ${message}`)
    if (input.controller.signal.aborted) return
    input.sink.emit({
      requestId: input.requestId,
      type: 'error',
      error: `Ajan süreci kullanılamadı: ${message}`
    })
  }
}

export function abortAllChats(): void {
  for (const [requestId, controller] of controllers) {
    rejectAllForRequest(requestId)
    rejectAllQuestions(requestId)
    clearSteering(requestId)
    if (workerRequests.has(requestId)) {
      void agentProcess()
        .cancelInWorker(requestId)
        .catch(() => undefined)
    }
    controller.abort()
  }
  controllers.clear()
  steerable.clear()
  workerRequests.clear()
}

export function abortChat(requestId: string): boolean {
  const controller = controllers.get(requestId)
  if (!controller) return false
  rejectAllForRequest(requestId)
  rejectAllQuestions(requestId)
  clearSteering(requestId)
  if (workerRequests.has(requestId)) {
    // İşçide çalışan koşu ayrıca iptal edilmeli; aksi halde süreç iş görmeye
    // devam eder ve kullanıcı "durdurdu" sanır.
    void agentProcess()
      .cancelInWorker(requestId)
      .catch(() => undefined)
  }
  steerable.delete(requestId)
  workerRequests.delete(requestId)
  controller.abort()
  controllers.delete(requestId)
  return true
}

/**
 * Çalışan bir ajan isteğine kullanıcı mesajı ekler.
 * Ajan döngüsü bir sonraki adımda bu mesajı konuşmaya katar.
 * `queued: false` ise çağıran taraf mesajı kendi sırasına almalıdır.
 */
export function steerChat(requestId: string, text: string): { queued: boolean; pending: number } {
  if (!controllers.has(requestId) || !steerable.has(requestId)) {
    return { queued: false, pending: 0 }
  }

  if (workerRequests.has(requestId)) {
    // İşçideki kuyruğa yazılır; ana süreçteki kuyruk kullanılmaz.
    void agentProcess()
      .steerInWorker(requestId, text)
      .catch(() => undefined)
    // Bildirim amaçlı: işçi gerçek sayıyı döndürür ama arayüz beklemez.
    return { queued: true, pending: 1 }
  }

  const queued = pushSteering(requestId, text)
  return { queued, pending: countSteering(requestId) }
}

export function steeringCount(requestId: string): number {
  return countSteering(requestId)
}

export function emitChatEvent(webContentsId: number, event: ChatEvent): void {
  const wc = webContents.fromId(webContentsId)
  if (wc && !wc.isDestroyed()) {
    wc.send('chat:event', event)
  }
}

/**
 * Kalıcı yeniden deneme durumu — OpenCode `Session.Message.Assistant.Retry`.
 *
 * Asistan mesajı akış başlarken kaydedilir; yeniden deneme bilgisi o mesaja
 * yazılır. Böylece uygulama kapansa bile "3. deneme, 14:32'de" kaybolmaz.
 * `retry: null` gönderilirse alan temizlenir (deneme başarılı oldu).
 */

/**
 * Asistan yanıtını ana süreçte biriktirip, akış bitince oturuma kaydeder.
 * Renderer sekme değiştirdiğinde veya kapandığında yanıt kaybolmaz.
 *
 * Biriktirme mantığı `chatStreamTracker.ts` içindedir (saf, test edilebilir).
 */
function createTrackingSend(
  requestId: string,
  webContentsId: number,
  sessionId: string | undefined
): (event: ChatEvent) => void {
  let state: StreamState = emptyStreamState()

  const persist = async (finishReason: string | null): Promise<void> => {
    if (!sessionId) return
    try {
      const store = await sessions()
      const existing = await store.get(sessionId)
      const prior = existing?.messages.find((message) => message.requestId === requestId)

      // Akış başında yer tutucu kayıt açıldıysa onu güncelle; yeniden
      // deneme bilgisi (retry) ve sürdürme sayacı korunur.
      if (prior) {
        const messages = existing!.messages.map((message) => {
          if (message.requestId !== requestId) return message
          // Başarılı turda retry bilgisi anlamını yitirir. Burada açıkça
          // silinir: ayrı bir "temizle" yazımı `persist` ile yarışıp eski
          // değeri geri getirebiliyordu (canlı testte gözlendi).
          const { retry: _cleared, ...rest } = message
          return {
            ...rest,
            content: state.content,
            reasoning: state.reasoning || undefined,
            usage: state.usage,
            finishReason
          }
        })
        await store.patch(sessionId, { messages })
        return
      }

      await store.appendMessage(sessionId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: state.content,
        reasoning: state.reasoning || undefined,
        createdAt: Date.now(),
        usage: state.usage,
        finishReason,
        requestId
      })
    } catch {
      // kayıt başarısız olsa da akış devam eder
    }
  }

  /** Günlüğe yazılacak asistan mesaj kimliği (kalıcı olay kaydı için). */
  const assistantMessageId = `assistant-${requestId}`
  let loggedStart = false

  /** ChatEvent → kalıcı olay (OpenCode `session.*` eşlemesi). */
  const logEvent = (event: ChatEvent): void => {
    if (!sessionId) return
    const seq = () => nextSeq(sessionId)
    switch (event.type) {
      case 'content':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'text.delta',
          data: { messageId: assistantMessageId, text: event.text }
        })
        return
      case 'reasoning':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'reasoning.delta',
          data: { messageId: assistantMessageId, text: event.text }
        })
        return
      case 'tool-call':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'tool.called',
          data: {
            messageId: assistantMessageId,
            id: event.call.id,
            name: event.call.name,
            arguments: event.call.arguments
          }
        })
        return
      case 'tool-result':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'tool.result',
          data: {
            messageId: assistantMessageId,
            toolCallId: event.result.toolCallId,
            name: event.result.name,
            ok: event.result.ok,
            content: event.result.content
          }
        })
        return
      case 'retry':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'retry.scheduled',
          data: {
            messageId: assistantMessageId,
            attempt: event.attempt,
            at: Date.now() + event.delayMs,
            error: { type: 'Retryable', message: event.reason }
          }
        })
        return
      case 'continue':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'continue.started',
          data: {
            messageId: assistantMessageId,
            reason: event.reason,
            attempt: event.attempt
          }
        })
        return
      case 'done':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'assistant.completed',
          data: { messageId: assistantMessageId, finishReason: event.finishReason }
        })
        return
      case 'error':
        void appendSessionEvent({
          seq: seq(),
          sessionId,
          type: 'assistant.failed',
          data: { messageId: assistantMessageId, error: event.error }
        })
        return
      default:
        return
    }
  }

  return (event: ChatEvent): void => {
    if (!belongsToRequest(event, requestId)) {
      emitChatEvent(webContentsId, event)
      return
    }
    // İlk olayda asistan mesajının başladığını günlüğe yaz.
    if (!loggedStart && sessionId) {
      loggedStart = true
      void appendSessionEvent({
        seq: nextSeq(sessionId),
        sessionId,
        type: 'assistant.started',
        data: { messageId: assistantMessageId }
      })
    }
    logEvent(event)
    const result = applyStreamEvent(state, event)
    state = result.state
    if (result.persist) void persist(result.persist.finishReason)
    // Retry yer tutucusu açıldıysa ve akış metinsiz hata verirse temizle.
    if (event.type === 'error') void dropEmptyPlaceholder(sessionId, requestId)
    emitChatEvent(webContentsId, event)
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    const { promises: fs } = await import('fs')
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export async function startChat(
  webContentsId: number,
  payload: ChatRequest
): Promise<{ requestId: string }> {
  const [key, settings] = await Promise.all([loadApiKey(), getSettings()])
  if (!key) throw new ApiError('API anahtarı bulunamadı. Lütfen anahtarınızı ekleyin.')
  if (!payload?.model) throw new ApiError('Model seçilmedi.')
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new ApiError('Mesaj listesi boş.')
  }

  const requestId = payload.requestId ?? crypto.randomUUID()
  const controller = new AbortController()
  controllers.set(requestId, controller)

  const send = createTrackingSend(requestId, webContentsId, payload.sessionId)

  const memoryContext = await buildMemoryContext(settings.baseUrl, key, payload.messages).catch(
    () => null
  )

  // Oturum kendi çalışma alanıyla çalışır; paralel sohbetler birbirini etkilemez.
  const session = payload.sessionId ? await (await sessions()).get(payload.sessionId) : null
  const workspaceRoot =
    payload.agent?.enabled && settings.workspaceTools !== false
      ? session?.workspacePath && (await pathExists(session.workspacePath))
        ? session.workspacePath
        : await ensureAgentWorkspace(payload.sessionId)
      : null

  const planMode = payload.agent?.profile === 'plan'
  const artifactInstruction = workspaceRoot
    ? planMode
      ? 'PLAN MODU etkin. Kaynak kodunu veya sistemi değiştirme; dosya yazma/düzenleme, komut çalıştırma ve bilgisayar kontrolü kapalıdır. ' +
        'read_file, list_files, glob ve grep ile incele; net bir uygulama planı ve todo_write ile görev listesi üret. ' +
        'Planı kullanıcı onayına sun; uygulamayı Build modunda yap.'
      : 'Çalışma alanı etkin. Kullanıcı bir dosya oluşturmanı, düzenlemeni veya incelemeni istediğinde ' +
        'read_file, write_file, edit_file, delete_file, list_files, glob, grep, run_command, run_checks, repo_map, code_search ve git araçlarını kullan. ' +
        'Dosya içeriğini yalnızca sohbete kod bloğu olarak dökmekle yetinme; gerçek dosyayı araçla oluştur. ' +
        'Düzenleme sonrası projede tanımlıysa run_checks ile doğrula. Git işlemleri için git aracını kullan.'
    : 'Kullanıcı bir dosya, rapor, belge veya markdown içeriği oluşturmanı istediğinde ' +
      'içeriği doğrudan yanıtında üret ve şu biçimde bir kod bloğu kullan: ' +
      '```<dil> title="dosya.ext"\n...içerik...\n```. ' +
      'Bunun için bir dosya yazma aracına veya REA/MCP aracına ihtiyacın yok; ' +
      'araçları yalnızca görev gerçekten tersine mühendislik, tarayıcı veya analiz gerektiriyorsa kullan.'

  const systemParts = [artifactInstruction, memoryContext].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  const augmentedPayload: ChatRequest =
    systemParts.length > 0
      ? {
          ...payload,
          messages: [
            { role: 'system', content: systemParts.join('\n\n') },
            ...payload.messages
          ]
        }
      : payload

  const runScoped = (task: () => Promise<void>): void => {
    void runWithWorkspace(workspaceRoot, task).finally(() => {
      controllers.delete(requestId)
      steerable.delete(requestId)
      workerRequests.delete(requestId)
      clearSteering(requestId)
    })
  }

  if (augmentedPayload.multiverse?.enabled) {
    runScoped(() =>
      runMultiverse({
        requestId,
        baseUrl: settings.baseUrl,
        apiKey: key,
        payload: augmentedPayload,
        controller,
        sink: asSink(send)
      })
    )
  } else if (augmentedPayload.agent?.enabled) {
    steerable.add(requestId)
    // Süreç ayrımı: ajan işçide koşabilir. Varsayılan ana süreçtir;
    // EVREN_AGENT_PROCESS=worker ile işçiye devredilir (tek satırla geri alınır).
    if (useWorkerForAgent()) {
      workerRequests.add(requestId)
      runScoped(() =>
        runAgentInWorker({
          requestId,
          baseUrl: settings.baseUrl,
          apiKey: key,
          payload: augmentedPayload,
          settings,
          workspaceRoot,
          sink: asSink(send),
          controller
        })
      )
    } else {
      runScoped(() =>
        runAgent({
          requestId,
          webContentsId,
          baseUrl: settings.baseUrl,
          apiKey: key,
          payload: augmentedPayload,
          controller,
          sink: asSink(send),
          workspaceRoot
        })
      )
    }
  } else {
    runScoped(() =>
      streamChat(
        requestId,
        settings.baseUrl,
        key,
        augmentedPayload,
        controller,
        send
      )
    )
  }

  return { requestId }
}

export async function streamChat(
  requestId: string,
  baseUrl: string,
  apiKey: string,
  payload: ChatRequest,
  controller: AbortController,
  send: (event: ChatEvent) => void
): Promise<void> {
  const body = buildBaseBody(payload)
  try {
    // OpenCode ile aynı: kesilen akış veya token limiti durumunda yanıt
    // kaldığı yerden devam ettirilir.
    const result = await streamWithContinuation({
      messages: (body.messages as ChatMessage[]) ?? [],
      signal: controller.signal,
      onDelta: (kind, text) => send({ requestId, type: kind, text }),
      run: (messagesToSend) =>
        streamCompletion(
          baseUrl,
          apiKey,
          { ...body, messages: messagesToSend },
          controller.signal,
          (delta) => send({ requestId, type: delta.kind, text: delta.text }),
          {
            onRetry: (info) => {
              // Kalıcı retry durumu: uygulama kapansa bile kaybolmaz.
              const retryInfo: StoredRetry = {
                attempt: info.attempt,
                at: Date.now() + info.delayMs,
                error: {
                  type: 'Retryable',
                  message: info.reason,
                  ...(info.retryAfterMs !== undefined
                    ? { retryAfterMs: info.retryAfterMs }
                    : {})
                }
              }
              void persistRetryState(payload.sessionId, requestId, { retry: retryInfo })
              send({
                requestId,
                type: 'retry',
                attempt: info.attempt,
                maxAttempts: info.maxAttempts,
                delayMs: info.delayMs,
                reason: info.reason
              })
            }
          }
        ),
      onContinue: (event) => {
        void persistRetryState(payload.sessionId, requestId, { retry: null })
        send({
          requestId,
          type: 'continue',
          reason: event.reason,
          attempt: event.attempt,
          chars: event.soFar
        })
      }
    })
    // Akış başarıyla bitti: retry yer tutucusundaki deneme bilgisi temizlenir.
    void persistRetryState(payload.sessionId, requestId, { retry: null })
    if (result.usage) send({ requestId, type: 'usage', usage: result.usage })
    send({ requestId, type: 'done', finishReason: result.finishReason })
  } catch (error) {
    send(toErrorEvent(requestId, error, controller))
  }
}
