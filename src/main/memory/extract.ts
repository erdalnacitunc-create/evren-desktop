import type { MemoryType } from '../../shared/types'
import { getSession, patchSession } from '../sessionStore'
import { getSettings } from '../settings'
import { embedTexts } from './embed'
import { addMemory, listMemories } from './store'

const MEMORY_TYPES = new Set<MemoryType>(['user', 'feedback', 'project', 'reference'])

const SECRET_PATTERNS = [
  /\b(sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/i,
  /\bevren_[A-Za-z0-9_-]{16,}\b/i,
  /\b[A-Fa-f0-9]{32,}\b/,
  /(password|parola|api[_-]?key|secret|token)\s*[:=]\s*\S{6,}/i
]

interface CandidateMemory {
  type: MemoryType
  text: string
  confidence?: number
  tags?: string[]
}

function looksSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function extractJsonArray(content: string): unknown[] {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isDuplicate(candidate: string, existing: string[]): boolean {
  const normalized = normalize(candidate)
  if (existing.some((item) => normalize(item) === normalized)) return true
  return existing.some((item) => {
    const other = normalize(item)
    if (other.length < 20 || normalized.length < 20) return false
    return other.includes(normalized) || normalized.includes(other)
  })
}

export async function learnFromSession(
  sessionId: string,
  baseUrl: string,
  apiKey: string
): Promise<{ added: number; skipped?: string }> {
  const session = await getSession(sessionId)
  if (!session) return { added: 0, skipped: 'session-not-found' }

  const settings = await getSettings()
  const memorySettings = settings.memory
  if (!memorySettings?.autoMemory) return { added: 0, skipped: 'disabled' }

  const lastLearned = session.lastMemoryLearnCount ?? 0
  if (session.messages.length - lastLearned < 2) {
    return { added: 0, skipped: 'not-enough-new-messages' }
  }

  const window = session.messages.slice(Math.max(lastLearned, session.messages.length - 10))
  const transcript = window
    .map((message) => {
      const content =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content)
      return `${message.role.toUpperCase()}: ${content.slice(0, 4000)}`
    })
    .join('\n\n')

  if (!transcript.trim()) return { added: 0, skipped: 'empty-window' }

  const existingMemories = await listMemories()
  const existingTexts = existingMemories.slice(0, 100).map((entry) => entry.text)
  const model =
    memorySettings.extractionModel === 'session'
      ? session.modelId
      : memorySettings.extractionModel

  const prompt = [
    'Aşağıdaki konuşmadan kalıcı olarak saklanmaya değer bilgileri çıkar.',
    'Yalnızca gelecekteki konuşmalarda işe yarayacak, kalıcı bilgileri seç:',
    'kullanıcı tercihleri, düzeltmeler, proje kararları, referans kaynakları.',
    'Geçici ayrıntıları, kod tabanından çıkarılabilecek şeyleri ve sırları atla.',
    'Zaten var olan anılarla aynı olanları üretme.',
    'Yanıtı SADECE şu şemada bir JSON dizisi olarak ver:',
    '[{"type":"user|feedback|project|reference","text":"...","confidence":0.0,"tags":["..."]}]',
    'En fazla 5 anı döndür. Uygun anı yoksa [] döndür.',
    existingTexts.length > 0
      ? `\nMevcut anılar (tekrar etme):\n${existingTexts.map((text) => `- ${text}`).join('\n')}`
      : '',
    `\nKonuşma:\n${transcript}`
  ]
    .filter(Boolean)
    .join('\n')

  let content = ''
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Sen EVREN Desktop için hafıza çıkarıcısın. Yalnızca geçerli JSON döndürürsün.'
          },
          { role: 'user', content: prompt }
        ],
        stream: false,
        max_tokens: 1200,
        temperature: 0.1
      })
    })

    if (!response.ok) return { added: 0, skipped: `http-${response.status}` }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string } }>
    }
    const message = json.choices?.[0]?.message
    content =
      typeof message?.content === 'string' && message.content.trim()
        ? message.content
        : (message?.reasoning ?? '')
  } catch {
    return { added: 0, skipped: 'request-failed' }
  }

  const candidates = extractJsonArray(content)
    .map((item) => item as CandidateMemory)
    .filter((item) => {
      if (!item || typeof item.text !== 'string') return false
      if (!MEMORY_TYPES.has(item.type)) return false
      if (typeof item.confidence === 'number' && item.confidence < 0.6) return false
      const text = item.text.replace(/\s+/g, ' ').trim()
      if (text.length < 5 || text.length > 600) return false
      if (looksSecret(text)) return false
      return true
    })
    .slice(0, 5)

  const fresh = candidates.filter(
    (item) => !isDuplicate(item.text, existingTexts)
  )

  if (fresh.length === 0) {
    await patchSession(sessionId, { lastMemoryLearnCount: session.messages.length })
    return { added: 0, skipped: 'no-new-memories' }
  }

  let embeddings: number[][] = []
  try {
    embeddings = await embedTexts(
      baseUrl,
      apiKey,
      fresh.map((item) => item.text)
    )
  } catch {
    embeddings = []
  }

  for (let index = 0; index < fresh.length; index += 1) {
    const item = fresh[index]
    await addMemory({
      type: item.type,
      text: item.text,
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 8).map(String) : undefined,
      sourceSessionId: sessionId,
      embedding: embeddings[index]
    })
  }

  await patchSession(sessionId, { lastMemoryLearnCount: session.messages.length })
  return { added: fresh.length }
}
