import type { ChatEvent } from '@shared/types'
import { api } from './ipc'

export interface StreamSnapshot {
  requestId: string
  sessionId: string
  content: string
  reasoning: string
  done: boolean
  finishReason: string | null
  usage?: import('@shared/types').ChatUsage
}

const byRequest = new Map<string, StreamSnapshot>()
const requestBySession = new Map<string, string>()
let listening = false

function ensureListener(): void {
  if (listening) return
  listening = true
  api.chat.onEvent((event: ChatEvent) => {
    applyEvent(event)
  })
}

function applyEvent(event: ChatEvent): void {
  const entry = byRequest.get(event.requestId)
  if (!entry) return
  if (event.type === 'content') entry.content += event.text
  else if (event.type === 'reasoning') entry.reasoning += event.text
  else if (event.type === 'usage') entry.usage = event.usage
  else if (event.type === 'done') {
    entry.done = true
    entry.finishReason = event.finishReason
  } else if (event.type === 'error') {
    entry.done = true
  }
}

export function registerStream(requestId: string, sessionId: string): void {
  ensureListener()
  const previous = requestBySession.get(sessionId)
  if (previous && previous !== requestId) byRequest.delete(previous)
  byRequest.set(requestId, {
    requestId,
    sessionId,
    content: '',
    reasoning: '',
    done: false,
    finishReason: null
  })
  requestBySession.set(sessionId, requestId)
}

export function getStreamForSession(sessionId: string): StreamSnapshot | null {
  const requestId = requestBySession.get(sessionId)
  if (!requestId) return null
  return byRequest.get(requestId) ?? null
}

export function clearStream(requestId: string): void {
  const entry = byRequest.get(requestId)
  if (entry && requestBySession.get(entry.sessionId) === requestId) {
    requestBySession.delete(entry.sessionId)
  }
  byRequest.delete(requestId)
}

export function isStreamingAnywhere(): boolean {
  for (const entry of byRequest.values()) {
    if (!entry.done) return true
  }
  return false
}
