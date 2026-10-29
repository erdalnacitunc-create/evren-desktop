import { webContents } from 'electron'
import { ApiError } from './api'
import { runAgent } from './agent/loop'
import { runMultiverse } from './multiverse'
import { rejectAllForRequest } from './agent/approval'
import { rejectAllQuestions } from './agent/question'
import { loadApiKey } from './credentials'
import { getSettings } from './settings'
import {
  ensureAgentWorkspace,
  getWorkspaceRoot,
  runWithWorkspace
} from './workspace'
import { getSession } from './sessionStore'
import { buildMemoryContext } from './memory/retrieve'
import { streamCompletion } from './sse'
import { buildBaseBody, toErrorEvent } from './chatShared'
import type { ChatEvent, ChatRequest, ChatUsage } from '../shared/types'

const controllers = new Map<string, AbortController>()

export function abortAllChats(): void {
  for (const [requestId, controller] of controllers) {
    rejectAllForRequest(requestId)
    rejectAllQuestions(requestId)
    controller.abort()
  }
  controllers.clear()
}

export function abortChat(requestId: string): boolean {
  const controller = controllers.get(requestId)
  if (!controller) return false
  rejectAllForRequest(requestId)
  rejectAllQuestions(requestId)
  controller.abort()
  controllers.delete(requestId)
  return true
}

export function emitChatEvent(webContentsId: number, event: ChatEvent): void {
  const wc = webContents.fromId(webContentsId)
  if (wc && !wc.isDestroyed()) {
    wc.send('chat:event', event)
  }
}

interface StreamAccumulator {
  content: string
  reasoning: string
  usage?: ChatUsage
  persisted: boolean
}

/**
 * Asistan yanıtını ana süreçte biriktirip, akış bitince oturuma kaydeder.
 * Renderer sekme değiştirdiğinde veya kapandığında yanıt kaybolmaz.
 */
function createTrackingSend(
  requestId: string,
  webContentsId: number,
  sessionId: string | undefined
): (event: ChatEvent) => void {
  const acc: StreamAccumulator = { content: '', reasoning: '', persisted: false }

  const persist = async (finishReason: string | null): Promise<void> => {
    if (acc.persisted || !sessionId) return
    if (!acc.content.trim() && !acc.reasoning.trim()) return
    acc.persisted = true
    try {
      const store = await import('./sessionStore')
      const existing = await store.getSession(sessionId)
      const duplicate = existing?.messages.some(
        (message) => message.requestId === requestId
      )
      if (duplicate) return
      await store.appendMessage(sessionId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: acc.content,
        reasoning: acc.reasoning || undefined,
        createdAt: Date.now(),
        usage: acc.usage,
        finishReason,
        requestId
      })
    } catch {
      // kayıt başarısız olsa da akış devam eder
    }
  }

  return (event: ChatEvent): void => {
    if (event.requestId !== requestId) {
      emitChatEvent(webContentsId, event)
      return
    }
    if (event.type === 'content') acc.content += event.text
    else if (event.type === 'reasoning') acc.reasoning += event.text
    else if (event.type === 'usage') acc.usage = event.usage
    else if (event.type === 'done') void persist(event.finishReason)
    else if (event.type === 'error') void persist(null)
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
  const session = payload.sessionId ? await getSession(payload.sessionId) : null
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
    void runWithWorkspace(workspaceRoot, task).finally(() =>
      controllers.delete(requestId)
    )
  }

  if (augmentedPayload.multiverse?.enabled) {
    runScoped(() =>
      runMultiverse({
        requestId,
        baseUrl: settings.baseUrl,
        apiKey: key,
        payload: augmentedPayload,
        controller,
        send
      })
    )
  } else if (augmentedPayload.agent?.enabled) {
    runScoped(() =>
      runAgent({
        requestId,
        webContentsId,
        baseUrl: settings.baseUrl,
        apiKey: key,
        payload: augmentedPayload,
        controller,
        send,
        workspaceRoot
      })
    )
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
  try {
    const result = await streamCompletion(
      baseUrl,
      apiKey,
      buildBaseBody(payload),
      controller.signal,
      (delta) => send({ requestId, type: delta.kind, text: delta.text })
    )
    if (result.usage) send({ requestId, type: 'usage', usage: result.usage })
    send({ requestId, type: 'done', finishReason: result.finishReason })
  } catch (error) {
    send(toErrorEvent(requestId, error, controller))
  }
}
