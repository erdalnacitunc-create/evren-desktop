import { promises as fs } from 'fs'
import { basename, isAbsolute, resolve } from 'path'
import { createServer as createTcpServer, type Socket } from 'net'
import { randomUUID } from 'crypto'
import type {
  AgentApprovalRequest,
  ChatEvent,
  ChatMessage,
  ChatUsage,
  PermissionCategory,
  StoredMessage
} from '../shared/types'
import { listModels } from './api'
import { runAgent } from './agent/loop'
import { loadApiKey } from './credentials'
import { getSettings } from './settings'
import { appendMessage, createSession, getSession, renameSession } from './sessionStore'
import { setWorkspaceRootOverride } from './workspace'

const ACP_VERSION = 1
const MAX_APPROVAL_MS = 5 * 60_000

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface AcpSession {
  sessionId: string
  cwd: string | null
  controller: AbortController | null
}

interface PendingClientRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  sessionId: string
}

const sessions = new Map<string, AcpSession>()
const pendingClient = new Map<number, PendingClientRequest>()
let nextClientRequestId = 1
let config: { baseUrl: string; apiKey: string; model: string } | null = null
let activeWrite: ((message: JsonRpcMessage) => void) | null = null
let promptQueue: Promise<void> = Promise.resolve()

function write(message: JsonRpcMessage): void {
  if (!activeWrite) return
  const line = JSON.stringify(message)
  if (process.env['EVREN_ACP_DEBUG'] === '1') {
    process.stderr.write(`[acp] send ${line.slice(0, 180)}\n`)
  }
  activeWrite(message)
}

function writeResult(id: number | string, result: unknown): void {
  write({ jsonrpc: '2.0', id, result })
}

function writeError(id: number | string, code: number, message: string): void {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

function notify(method: string, params: unknown): void {
  write({ jsonrpc: '2.0', method, params })
}

function sessionUpdate(sessionId: string, update: Record<string, unknown>): void {
  notify('session/update', { sessionId, update })
}

async function ensureConfig(): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  if (config) return config
  const [apiKey, settings] = await Promise.all([loadApiKey(), getSettings()])
  if (!apiKey) throw new Error('EVREN API anahtarı yok. Uygulamada anahtar kaydedin.')
  const models = await listModels(settings.baseUrl, apiKey)
  const preferred = process.env['EVREN_ACP_MODEL']?.trim()
  const model =
    (preferred && models.find((item) => item.id === preferred)?.id) ||
    models.find((item) => item.task === 'chat' || item.task === 'vision_chat')?.id
  if (!model) throw new Error('Kullanılabilir sohbet modeli bulunamadı.')
  config = { baseUrl: settings.baseUrl, apiKey, model }
  return config
}

function requestClient(method: string, params: unknown, sessionId: string): Promise<unknown> {
  const id = nextClientRequestId++
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pendingClient.delete(id)
      rejectPromise(new Error('ACP istemcisi zaman aşımına uğradı.'))
    }, MAX_APPROVAL_MS)
    pendingClient.set(id, {
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
      sessionId
    })
    write({ jsonrpc: '2.0', id, method, params })
  })
}

function cancelPendingForSession(sessionId: string): void {
  for (const [id, pending] of pendingClient) {
    if (pending.sessionId !== sessionId) continue
    clearTimeout(pending.timer)
    pendingClient.delete(id)
    pending.reject(new Error('cancelled'))
  }
}

function toolKind(category: PermissionCategory): string {
  if (category === 'read') return 'read'
  if (category === 'edit') return 'edit'
  if (category === 'execute') return 'execute'
  if (category === 'browser') return 'fetch'
  return 'other'
}

function locationsFor(args: Record<string, unknown>, cwd: string | null): Array<{ path: string }> {
  const locations: Array<{ path: string }> = []
  for (const key of ['path', 'file_path', 'cwd']) {
    const value = args[key]
    if (typeof value !== 'string' || !value.trim()) continue
    const path = isAbsolute(value) ? value : cwd ? resolve(cwd, value) : value
    locations.push({ path })
  }
  return locations
}

async function requestPermission(
  session: AcpSession,
  request: AgentApprovalRequest
): Promise<boolean> {
  try {
    const response = (await requestClient(
      'session/request_permission',
      {
        sessionId: session.sessionId,
        toolCall: {
          toolCallId: request.toolCallId,
          title: request.summary,
          kind: toolKind(request.category),
          status: 'pending',
          locations: locationsFor(request.args, session.cwd),
          rawInput: request.args
        },
        options: [
          { optionId: 'allow_once', name: 'Bu sefer izin ver', kind: 'allow_once' },
          { optionId: 'allow_always', name: 'Her zaman izin ver', kind: 'allow_always' },
          { optionId: 'reject_once', name: 'Reddet', kind: 'reject_once' }
        ]
      },
      session.sessionId
    )) as {
      outcome?: { outcome?: string; optionId?: string }
    }
    if (response?.outcome?.outcome !== 'selected') return false
    return String(response.outcome.optionId ?? '').startsWith('allow')
  } catch {
    return false
  }
}

function promptText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return ''
  const parts: string[] = []
  for (const block of prompt) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
    } else if (item.type === 'resource' && item.resource) {
      const resource = item.resource as Record<string, unknown>
      if (typeof resource.text === 'string') {
        parts.push(`\n\nDosya: ${String(resource.uri ?? '')}\n${resource.text}`)
      } else if (typeof resource.uri === 'string') {
        parts.push(`\n\nDosya: ${resource.uri}`)
      }
    } else if (item.type === 'resource_link' && typeof item.uri === 'string') {
      parts.push(`\n\nBağlantı: ${item.uri}`)
    } else if (item.type === 'image') {
      parts.push('\n\n[Görsel eki ACP üzerinden metne dönüştürülmedi.]')
    }
  }
  return parts.join('').trim()
}

async function handlePrompt(
  sessionId: string,
  prompt: unknown,
  requestId: number | string
): Promise<void> {
  const run = promptQueue.then(
    () => runPrompt(sessionId, prompt, requestId),
    () => runPrompt(sessionId, prompt, requestId)
  )
  promptQueue = run.catch(() => undefined)
  return run
}

async function runPrompt(
  sessionId: string,
  prompt: unknown,
  requestId: number | string
): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) {
    writeError(requestId, -32602, `Oturum bulunamadı: ${sessionId}`)
    return
  }
  const text = promptText(prompt)
  if (!text) {
    writeError(requestId, -32602, 'Desteklenen bir prompt içeriği yok.')
    return
  }
  if (session.controller) {
    writeError(requestId, -32600, 'Bu oturumda zaten çalışan bir istek var.')
    return
  }

  const { baseUrl, apiKey, model } = await ensureConfig()
  const stored = await getSession(sessionId)
  if (!stored) {
    writeError(requestId, -32602, `Oturum bulunamadı: ${sessionId}`)
    return
  }
  const history: ChatMessage[] = stored.messages
    .filter((message) => message.content.trim())
    .map((message) => ({ role: message.role, content: message.content }))
  const userMessage: StoredMessage = {
    id: randomUUID(),
    role: 'user',
    content: text,
    createdAt: Date.now()
  }
  await appendMessage(sessionId, userMessage)
  history.push({ role: 'user', content: text })

  const controller = new AbortController()
  session.controller = controller
  setWorkspaceRootOverride(session.cwd)
  let content = ''
  let reasoning = ''
  let usage: ChatUsage | undefined
  let finishReason: string | null = null
  let error: string | null = null
  const messageId = `msg_${randomUUID()}`
  const thoughtId = `thought_${randomUUID()}`

  const handleEvent = (event: ChatEvent): void => {
    if (event.type === 'content') {
      content += event.text
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text: event.text }
      })
    } else if (event.type === 'reasoning') {
      reasoning += event.text
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_thought_chunk',
        messageId: thoughtId,
        content: { type: 'text', text: event.text }
      })
    } else if (event.type === 'tool-call') {
      sessionUpdate(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: event.call.id,
        title: event.call.name,
        kind: 'other',
        status: 'pending',
        rawInput: (() => {
          try {
            return JSON.parse(event.call.arguments || '{}') as unknown
          } catch {
            return event.call.arguments
          }
        })()
      })
    } else if (event.type === 'tool-result') {
      sessionUpdate(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.result.toolCallId,
        status: event.result.ok ? 'completed' : 'failed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: event.result.content }
          }
        ],
        rawOutput: { content: event.result.content }
      })
    } else if (event.type === 'usage') {
      usage = event.usage
    } else if (event.type === 'done') {
      finishReason = event.finishReason
    } else if (event.type === 'error') {
      error = event.error
    }
  }

  try {
    await runAgent({
      requestId: String(requestId),
      webContentsId: -1,
      baseUrl,
      apiKey,
      payload: {
        model,
        messages: history,
        sessionId,
        agent: {
          enabled: true,
          mode: 'confirm',
          profile: 'build',
          browser: false,
          computer: false,
          workspace: true
        }
      },
      controller,
      send: handleEvent,
      approval: (approval) => requestPermission(session, approval),
      workspaceRoot: session.cwd
    })
  } finally {
    session.controller = null
    cancelPendingForSession(sessionId)
    setWorkspaceRootOverride(null)
  }

  const assistant: StoredMessage = {
    id: randomUUID(),
    role: 'assistant',
    content,
    reasoning: reasoning || undefined,
    createdAt: Date.now(),
    usage,
    finishReason
  }
  if (content || reasoning) {
    await appendMessage(sessionId, assistant)
  }

  if (error) {
    writeError(requestId, -32000, error)
    return
  }
  if (controller.signal.aborted) {
    writeResult(requestId, { stopReason: 'cancelled' })
    return
  }
  const stopReason =
    finishReason === 'length'
      ? 'max_tokens'
      : finishReason === 'max-steps'
        ? 'max_turn_requests'
        : 'end_turn'
  writeResult(requestId, { stopReason })
}

async function handleRequest(
  id: number | string,
  method: string,
  params: Record<string, unknown>
): Promise<void> {
  if (method === 'initialize') {
    writeResult(id, {
      protocolVersion: ACP_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true
        },
        mcpCapabilities: { http: false, sse: false }
      },
      agentInfo: {
        name: 'evren-desktop',
        title: 'EVREN Desktop',
        version: '0.1.0'
      },
      authMethods: []
    })
    return
  }

  if (method === 'authenticate') {
    writeResult(id, {})
    return
  }

  if (method === 'session/new') {
    const { model } = await ensureConfig()
    const requestedModel =
      typeof params._meta === 'object' &&
      params._meta &&
      typeof (params._meta as Record<string, unknown>).model === 'string'
        ? String((params._meta as Record<string, unknown>).model)
        : model
    const cwdRaw = typeof params.cwd === 'string' ? params.cwd : ''
    let cwd: string | null = null
    if (cwdRaw && isAbsolute(cwdRaw)) {
      try {
        const real = await fs.realpath(cwdRaw)
        const stat = await fs.stat(real)
        if (stat.isDirectory()) cwd = real
      } catch {
        cwd = null
      }
    }
    const stored = await createSession(requestedModel)
    await renameSession(stored.id, `ACP: ${cwd ? basename(cwd) : 'sohbet'}`)
    sessions.set(stored.id, { sessionId: stored.id, cwd, controller: null })
    process.stderr.write(`[acp] session ${stored.id} cwd=${cwd ?? '-'}\n`)
    writeResult(id, { sessionId: stored.id })
    return
  }

  if (method === 'session/prompt') {
    const sessionId = String(params.sessionId ?? '')
    await handlePrompt(sessionId, params.prompt, id)
    return
  }

  if (method === 'session/set_mode' || method === 'session/set_config_option') {
    writeResult(id, {})
    return
  }

  if (method === 'session/load') {
    writeError(id, -32601, 'session/load desteklenmiyor (loadSession=false).')
    return
  }

  if (method === 'logout') {
    writeResult(id, {})
    return
  }

  writeError(id, -32601, `Bilinmeyen ACP metodu: ${method}`)
}

function handleNotification(method: string, params: Record<string, unknown>): void {
  if (method === 'session/cancel') {
    const sessionId = String(params.sessionId ?? '')
    const session = sessions.get(sessionId)
    session?.controller?.abort()
    cancelPendingForSession(sessionId)
  }
}

function processLine(trimmed: string): void {
  if (process.env['EVREN_ACP_DEBUG'] === '1') {
    process.stderr.write(`[acp] recv ${trimmed.slice(0, 180)}\n`)
  }
  let message: JsonRpcMessage
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage
  } catch {
    process.stderr.write('[acp] Geçersiz JSON satırı alındı\n')
    return
  }

  if (message.method) {
    if (message.id !== undefined) {
      void handleRequest(message.id, message.method, message.params as Record<string, unknown>)
        .catch((error) => {
          writeError(
            message.id as number | string,
            -32603,
            error instanceof Error ? error.message : String(error)
          )
        })
    } else {
      handleNotification(message.method, (message.params ?? {}) as Record<string, unknown>)
    }
    return
  }

  if (typeof message.id === 'number') {
    const pending = pendingClient.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingClient.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  }
}

export function startAcp(): void {
  const port = Number(process.env['EVREN_ACP_PORT'] || 45998)
  const expectedToken = process.env['EVREN_ACP_TOKEN']?.trim() || null
  let activeSocket: Socket | null = null

  const server = createTcpServer((socket) => {
    if (activeSocket) {
      socket.destroy()
      return
    }
    activeSocket = socket
    socket.setEncoding('utf8')
    let buffer = ''
    let authenticated = !expectedToken
    const send = (message: JsonRpcMessage): void => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
    }
    activeWrite = send

    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (!authenticated) {
          try {
            const handshake = JSON.parse(trimmed) as { evren_acp_token?: string }
            if (expectedToken && handshake.evren_acp_token === expectedToken) {
              authenticated = true
              continue
            }
          } catch {
            // geçersiz handshake
          }
          socket.destroy()
          return
        }
        processLine(trimmed)
      }
    })

    socket.on('close', () => {
      if (activeSocket === socket) {
        activeSocket = null
        activeWrite = null
        for (const session of sessions.values()) session.controller?.abort()
        for (const [id, pending] of pendingClient) {
          clearTimeout(pending.timer)
          pendingClient.delete(id)
          pending.reject(new Error('ACP bağlantısı kapandı.'))
        }
      }
    })
    socket.on('error', () => undefined)
  })

  server.once('error', (error) => {
    process.stderr.write(`[acp] sunucu hatası: ${error.message}\n`)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[acp] EVREN Desktop ACP agent hazır: 127.0.0.1:${port}\n`)
  })
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))
}
