import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  ChatEvent,
  ChatUsage
} from '@shared/types'
import { api } from './ipc'

export interface StreamSnapshot {
  requestId: string
  sessionId: string
  content: string
  reasoning: string
  done: boolean
  finishReason: string | null
  usage?: ChatUsage
  approval?: AgentApprovalRequest
  question?: AgentQuestionRequest
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

function drop(requestId: string): void {
  const entry = byRequest.get(requestId)
  if (entry && requestBySession.get(entry.sessionId) === requestId) {
    requestBySession.delete(entry.sessionId)
  }
  byRequest.delete(requestId)
}

function applyEvent(event: ChatEvent): void {
  const entry = byRequest.get(event.requestId)
  if (!entry) return
  if (event.type === 'content') entry.content += event.text
  else if (event.type === 'reasoning') entry.reasoning += event.text
  else if (event.type === 'usage') entry.usage = event.usage
  else if (event.type === 'approval') entry.approval = event.request
  else if (event.type === 'question') entry.question = event.request
  else if (event.type === 'tool-result') entry.approval = undefined
  else if (event.type === 'done') {
    entry.done = true
    entry.finishReason = event.finishReason
    entry.approval = undefined
    entry.question = undefined
    drop(event.requestId)
  } else if (event.type === 'error') {
    drop(event.requestId)
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
  drop(requestId)
}

export function clearPendingApproval(requestId: string, toolCallId?: string): void {
  const entry = byRequest.get(requestId)
  if (!entry) return
  if (!toolCallId || entry.approval?.toolCallId === toolCallId) {
    entry.approval = undefined
  }
}

export function clearPendingQuestion(requestId: string, questionId?: string): void {
  const entry = byRequest.get(requestId)
  if (!entry) return
  if (!questionId || entry.question?.question.id === questionId) {
    entry.question = undefined
  }
}

export function isStreamingAnywhere(): boolean {
  for (const entry of byRequest.values()) {
    if (!entry.done) return true
  }
  return false
}

export function listActiveSessions(): Array<{
  sessionId: string
  streaming: boolean
  pendingInput: boolean
}> {
  const result: Array<{ sessionId: string; streaming: boolean; pendingInput: boolean }> = []
  for (const entry of byRequest.values()) {
    result.push({
      sessionId: entry.sessionId,
      streaming: !entry.done,
      pendingInput: !!entry.approval || !!entry.question
    })
  }
  return result
}

export function hasPendingInput(sessionId: string): boolean {
  const entry = getStreamForSession(sessionId)
  return !!entry?.approval || !!entry?.question
}
