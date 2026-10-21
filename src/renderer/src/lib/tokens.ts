import type { ChatMessage } from '@shared/types'

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function estimateMessageTokens(content: ChatMessage['content']): number {
  if (typeof content === 'string') return estimateTokens(content) + 8
  const parts = content.reduce(
    (sum, part) => sum + (part.type === 'text' ? estimateTokens(part.text) : 0),
    0
  )
  return parts + 8
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message.content), 0)
}
