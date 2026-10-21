import type { ChatMessage, ModelInfo } from '@shared/types'

export interface MultiverseEstimate {
  promptTokens: number
  memberOutputTokens: number
  synthesisOutputTokens: number
  totalTokens: number
  cost: number | null
  currency: string
}

function messageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}

export function estimateMultiverse(args: {
  models: ModelInfo[]
  primaryId: string
  memberIds: string[]
  messages: ChatMessage[]
  maxTokens?: number
}): MultiverseEstimate {
  const promptChars = args.messages.reduce(
    (sum, message) => sum + messageText(message.content).length,
    0
  )
  const promptTokens = Math.max(1, Math.ceil(promptChars / 4))
  const memberOutputTokens = Math.max(64, Math.min(1024, args.maxTokens ?? 1024))
  const synthesisOutputTokens = Math.max(64, Math.min(2048, args.maxTokens ?? 1024))

  const totalTokens =
    promptTokens * (1 + args.memberIds.length) +
    memberOutputTokens * args.memberIds.length +
    synthesisOutputTokens

  const byId = new Map(args.models.map((model) => [model.id, model]))
  let cost = 0
  let currency = 'CR'
  let priced = true

  for (const memberId of args.memberIds) {
    const pricing = byId.get(memberId)?.pricing
    if (!pricing) {
      priced = false
      continue
    }
    currency = pricing.currency || currency
    cost +=
      promptTokens * pricing.prompt_token_price +
      memberOutputTokens * pricing.completion_token_price
  }

  const primaryPricing = byId.get(args.primaryId)?.pricing
  if (!primaryPricing) {
    priced = false
  } else {
    currency = primaryPricing.currency || currency
    cost +=
      (promptTokens + memberOutputTokens * args.memberIds.length) *
        primaryPricing.prompt_token_price +
      synthesisOutputTokens * primaryPricing.completion_token_price
  }

  return {
    promptTokens,
    memberOutputTokens,
    synthesisOutputTokens,
    totalTokens,
    cost: priced ? cost : null,
    currency
  }
}
