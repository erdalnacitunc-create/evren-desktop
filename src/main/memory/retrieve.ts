import type { ChatMessage, MemoryEntry } from '../../shared/types'
import { embedText } from './embed'
import {
  getInstructions,
  getMemorySettings,
  listMemories,
  markMemoriesUsed
} from './store'

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9çğıöşü]+/i)
    .filter((token) => token.length > 2)
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function keywordScore(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0
  const textTokens = new Set(tokenize(text))
  let hits = 0
  for (const token of queryTokens) {
    if (textTokens.has(token)) hits += 1
  }
  return hits / queryTokens.size
}

function lastUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue
    const content = messages[index].content
    if (typeof content === 'string') return content
    return content
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text ?? '')
      .join('\n')
  }
  return ''
}

export async function retrieveMemories(
  baseUrl: string,
  apiKey: string,
  query: string,
  topK: number,
  tokenBudget: number
): Promise<MemoryEntry[]> {
  const entries = await listMemories()
  if (entries.length === 0) return []

  const queryEmbedding = query ? await embedText(baseUrl, apiKey, query) : null
  const queryTokens = new Set(tokenize(query))
  const now = Date.now()

  const scored = entries.map((entry) => {
    const semantic =
      queryEmbedding && entry.embedding ? cosine(queryEmbedding, entry.embedding) : 0
    const keyword = keywordScore(queryTokens, entry.text)
    const days = (now - (entry.lastUsedAt ?? entry.updatedAt)) / 86_400_000
    const recency = 1 / (1 + days / 30)
    const pin = entry.pinned ? 0.15 : 0
    const typeWeight =
      entry.type === 'feedback' ? 1.05 : entry.type === 'user' ? 1.03 : 1
    const score = (semantic * 0.65 + keyword * 0.2 + recency * 0.1 + pin) * typeWeight
    return { entry, score }
  })

  scored.sort((a, b) => b.score - a.score)

  const selected: MemoryEntry[] = []
  let budget = tokenBudget
  for (const { entry } of scored) {
    if (selected.length >= topK) break
    const cost = Math.ceil(entry.text.length / 4) + 8
    if (selected.length > 0 && cost > budget) break
    selected.push(entry)
    budget -= cost
  }

  await markMemoriesUsed(selected.map((entry) => entry.id))
  return selected
}

export async function buildMemoryContext(
  baseUrl: string,
  apiKey: string,
  messages: ChatMessage[]
): Promise<string | null> {
  const settings = await getMemorySettings()
  const instructions = (await getInstructions()).trim().slice(0, 8000)
  const query = lastUserText(messages)

  const memories = await retrieveMemories(
    baseUrl,
    apiKey,
    query,
    settings.retrievalTopK,
    settings.retrievalTokenBudget
  )

  if (!instructions && memories.length === 0) return null

  const parts: string[] = []
  if (instructions) {
    parts.push(`Kullanıcının kalıcı talimatları:\n${instructions}`)
  }
  if (memories.length > 0) {
    parts.push(
      `İlgili anılar:\n${memories
        .map((entry) => `- [${entry.type}] ${entry.text}`)
        .join('\n')}`
    )
  }

  return parts.join('\n\n')
}
