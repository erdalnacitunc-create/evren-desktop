import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { Readable } from 'stream'
import type { HeadlessStatus } from '../shared/types'
import { ensureHeadlessToken, loadApiKey, loadHeadlessToken } from './credentials'
import { extractToken, tokensMatch } from './transport/protocol'
import { getSettings } from './settings'
import {
  createSession,
  deleteSession,
  getSession,
  listSessions
} from './sessionStore'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 45871
const MAX_BODY_BYTES = 50 * 1024 * 1024

let server: Server | null = null
let currentToken: string | null = null
let currentPort = DEFAULT_PORT
let lastError: string | undefined
let requestCount = 0
let lastRequestAt: number | null = null

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, {
    error: { message, type: 'evren_headless_error', code: status }
  })
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('İstek gövdesi çok büyük.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Headless API istek yetkilendirmesi (saf fonksiyon, test edilebilir).
 * Sabit zamanlı karşılaştırma: token uzunluğu/başlangıcı sızdırılmaz.
 */
export function isAuthorized(
  expectedToken: string | null | undefined,
  headers: Record<string, string | string[] | undefined>
): boolean {
  if (!expectedToken) return false
  const provided = extractToken(headers)
  return tokensMatch(expectedToken, provided)
}

function authorized(request: IncomingMessage): boolean {
  return isAuthorized(currentToken, {
    authorization: request.headers.authorization,
    'x-evren-token': request.headers['x-evren-token'] as string | string[] | undefined
  })
}

function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/v1\/sessions\/([^/]+)$/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

async function handleSessions(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (pathname === '/v1/sessions' && request.method === 'GET') {
    const sessions = await listSessions()
    sendJson(response, 200, { object: 'list', data: sessions })
    return true
  }
  if (pathname === '/v1/sessions' && request.method === 'POST') {
    const body = await readBody(request)
    let parsed: { model?: string } = {}
    try {
      parsed = JSON.parse(body.toString('utf8') || '{}') as { model?: string }
    } catch {
      sendError(response, 400, 'Geçersiz JSON.')
      return true
    }
    if (!parsed.model) {
      sendError(response, 400, 'model alanı gerekli.')
      return true
    }
    const session = await createSession(parsed.model)
    sendJson(response, 200, session)
    return true
  }
  const sessionId = sessionIdFromPath(pathname)
  if (sessionId && request.method === 'GET') {
    const session = await getSession(sessionId)
    if (!session) sendError(response, 404, 'Oturum bulunamadı.')
    else sendJson(response, 200, session)
    return true
  }
  if (sessionId && request.method === 'DELETE') {
    const deleted = await deleteSession(sessionId)
    sendJson(response, deleted ? 200 : 404, { deleted })
    return true
  }
  return false
}

async function proxy(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    sendError(response, 503, 'EVREN API anahtarı kayıtlı değil.')
    return
  }

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request)
  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    Accept: String(request.headers.accept ?? 'application/json'),
    'User-Agent': 'EVREN-Desktop-Headless/0.1.0'
  }
  if (request.headers['content-type']) {
    headers['Content-Type'] = String(request.headers['content-type'])
  }
  for (const name of ['anthropic-version', 'anthropic-beta', 'openai-beta']) {
    const value = request.headers[name]
    if (value) headers[name] = String(value)
  }

  const upstream = await fetch(`${settings.baseUrl}${pathname}`, {
    method: request.method ?? 'GET',
    headers,
    body: body as unknown as BodyInit | undefined,
    signal: controller.signal
  })

  const contentType = upstream.headers.get('content-type') ?? 'application/json'
  const outputHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  }
  const requestId = upstream.headers.get('x-request-id')
  if (requestId) outputHeaders['x-request-id'] = requestId
  response.writeHead(upstream.status, outputHeaders)

  if (contentType.includes('text/event-stream') && upstream.body) {
    const stream = Readable.fromWeb(
      upstream.body as unknown as import('stream/web').ReadableStream
    )
    stream.pipe(response)
    stream.on('error', () => response.destroy())
    return
  }

  const buffer = Buffer.from(await upstream.arrayBuffer())
  response.end(buffer)
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  requestCount += 1
  lastRequestAt = Date.now()
  const url = new URL(request.url ?? '/', `http://${HOST}`)
  const pathname = url.pathname

  if (pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      app: 'evren-desktop',
      version: '0.1.0',
      headless: true
    })
    return
  }

  if (!pathname.startsWith('/v1/')) {
    sendError(response, 404, 'Bilinmeyen uç nokta.')
    return
  }

  if (!authorized(request)) {
    sendError(response, 401, 'Geçersiz veya eksik bearer token.')
    return
  }

  if (await handleSessions(request, response, pathname)) return

  try {
    await proxy(request, response, `${pathname}${url.search}`)
  } catch (error) {
    if (response.writableEnded) return
    const message = error instanceof Error ? error.message : String(error)
    if (!response.headersSent) sendError(response, 502, `EVREN API hatası: ${message}`)
    else response.destroy()
  }
}

export async function startHeadlessServer(port?: number): Promise<HeadlessStatus> {
  const settings = await getSettings()
  const desiredPort = Math.round(port ?? settings.headless?.port ?? DEFAULT_PORT)
  if (server && currentPort === desiredPort) return headlessStatus()

  await stopHeadlessServer()
  lastError = undefined
  currentPort = desiredPort
  currentToken = await ensureHeadlessToken()

  const nextServer = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (!response.headersSent) {
        sendError(response, 500, error instanceof Error ? error.message : String(error))
      } else if (!response.writableEnded) {
        response.destroy()
      }
    })
  })

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      nextServer.removeListener('listening', onListening)
      lastError =
        error.code === 'EADDRINUSE'
          ? `Port ${desiredPort} kullanımda.`
          : error.message
      reject(new Error(lastError))
    }
    const onListening = (): void => {
      nextServer.removeListener('error', onError)
      resolvePromise()
    }
    nextServer.once('error', onError)
    nextServer.once('listening', onListening)
    nextServer.listen(desiredPort, HOST)
  })

  server = nextServer
  return headlessStatus()
}

export async function stopHeadlessServer(): Promise<void> {
  const current = server
  server = null
  if (!current) return
  await new Promise<void>((resolvePromise) => {
    current.close(() => resolvePromise())
    setTimeout(() => resolvePromise(), 2_000)
  })
}

export async function restartHeadlessServer(port?: number): Promise<HeadlessStatus> {
  await stopHeadlessServer()
  return startHeadlessServer(port)
}

export async function headlessStatus(): Promise<HeadlessStatus> {
  const token = await loadHeadlessToken()
  if (!server) {
    const settings = await getSettings()
    currentPort = settings.headless?.port ?? currentPort
  }
  return {
    running: !!server,
    host: HOST,
    port: currentPort,
    baseUrl: `http://${HOST}:${currentPort}`,
    token,
    requestCount,
    lastRequestAt,
    error: lastError
  }
}

export async function applyHeadlessSettings(): Promise<void> {
  const settings = await getSettings()
  const enabled = settings.headless?.enabled === true
  if (enabled) {
    try {
      await startHeadlessServer(settings.headless?.port ?? DEFAULT_PORT)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  } else {
    await stopHeadlessServer()
  }
}
