import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { MemoryEntry, MemorySettings, MemoryType } from '../../shared/types'
import { getSettings, updateSettings } from '../settings'

interface MemoryData {
  entries: MemoryEntry[]
  instructions: string
}

let cache: MemoryData | null = null

function paths(): { encrypted: string; plain: string; directory: string } {
  const directory = join(app.getPath('userData'), 'memory')
  return {
    directory,
    encrypted: join(directory, 'memory.bin'),
    plain: join(directory, 'memory.json')
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

async function load(): Promise<MemoryData> {
  if (cache) return cache
  const target = paths()
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = await fs.readFile(target.encrypted)
      cache = JSON.parse(safeStorage.decryptString(encrypted)) as MemoryData
    } else {
      cache = JSON.parse(await fs.readFile(target.plain, 'utf8')) as MemoryData
    }
  } catch {
    cache = { entries: [], instructions: '' }
  }

  if (!Array.isArray(cache.entries)) cache.entries = []
  if (typeof cache.instructions !== 'string') cache.instructions = ''
  return cache
}

async function persist(): Promise<void> {
  const data = cache ?? { entries: [], instructions: '' }
  const target = paths()
  await fs.mkdir(target.directory, { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(target.encrypted, safeStorage.encryptString(JSON.stringify(data)), {
      mode: 0o600
    })
  } else {
    await fs.writeFile(target.plain, JSON.stringify(data, null, 2), 'utf8')
  }
}

export async function listMemories(query?: string): Promise<MemoryEntry[]> {
  const data = await load()
  const needle = query?.trim().toLowerCase()
  const filtered = needle
    ? data.entries.filter(
        (entry) =>
          entry.text.toLowerCase().includes(needle) ||
          (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      )
    : data.entries

  return [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

export async function addMemory(input: {
  type: MemoryType
  text: string
  tags?: string[]
  sourceSessionId?: string
  pinned?: boolean
  embedding?: number[]
}): Promise<MemoryEntry> {
  const data = await load()
  const text = input.text.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('Anı metni boş olamaz.')

  const existing = data.entries.find(
    (entry) => normalizeText(entry.text) === normalizeText(text)
  )
  if (existing) {
    existing.updatedAt = Date.now()
    if (input.embedding) existing.embedding = input.embedding
    await persist()
    return existing
  }

  const now = Date.now()
  const entry: MemoryEntry = {
    id: crypto.randomUUID(),
    type: input.type,
    text,
    tags: input.tags,
    sourceSessionId: input.sourceSessionId,
    createdAt: now,
    updatedAt: now,
    pinned: input.pinned ?? false,
    embedding: input.embedding
  }
  data.entries.push(entry)

  const settings = await getMemorySettings()
  if (data.entries.length > settings.maxMemories) {
    const removable = data.entries
      .filter((item) => !item.pinned)
      .sort((a, b) => (a.lastUsedAt ?? a.updatedAt) - (b.lastUsedAt ?? b.updatedAt))
    const removeCount = data.entries.length - settings.maxMemories
    const removeIds = new Set(removable.slice(0, removeCount).map((item) => item.id))
    data.entries = data.entries.filter((item) => !removeIds.has(item.id))
  }

  await persist()
  return entry
}

export async function updateMemory(
  id: string,
  patch: Partial<Pick<MemoryEntry, 'text' | 'type' | 'tags' | 'pinned' | 'embedding'>>
): Promise<MemoryEntry | null> {
  const data = await load()
  const entry = data.entries.find((item) => item.id === id)
  if (!entry) return null

  if (typeof patch.text === 'string') {
    const text = patch.text.replace(/\s+/g, ' ').trim()
    if (!text) throw new Error('Anı metni boş olamaz.')
    entry.text = text
  }
  if (patch.type) entry.type = patch.type
  if (patch.tags) entry.tags = patch.tags
  if (typeof patch.pinned === 'boolean') entry.pinned = patch.pinned
  if (patch.embedding) entry.embedding = patch.embedding
  entry.updatedAt = Date.now()

  await persist()
  return entry
}

export async function deleteMemory(id: string): Promise<boolean> {
  const data = await load()
  const index = data.entries.findIndex((entry) => entry.id === id)
  if (index < 0) return false
  data.entries.splice(index, 1)
  await persist()
  return true
}

export async function deleteMatching(query: string): Promise<number> {
  const data = await load()
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const before = data.entries.length
  data.entries = data.entries.filter(
    (entry) =>
      !entry.text.toLowerCase().includes(needle) &&
      !(entry.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
  )
  const removed = before - data.entries.length
  if (removed > 0) await persist()
  return removed
}

export async function clearMemories(): Promise<void> {
  const data = await load()
  data.entries = []
  await persist()
}

export async function getInstructions(): Promise<string> {
  return (await load()).instructions
}

export async function setInstructions(text: string): Promise<void> {
  const data = await load()
  data.instructions = String(text ?? '').slice(0, 100_000)
  await persist()
}

export async function getMemorySettings(): Promise<MemorySettings> {
  const settings = await getSettings()
  return (
    settings.memory ?? {
      autoMemory: true,
      extractionModel: 'session',
      retrievalTopK: 6,
      retrievalTokenBudget: 900,
      maxMemories: 2000
    }
  )
}

export async function updateMemorySettings(
  patch: Partial<MemorySettings>
): Promise<MemorySettings> {
  const current = await getMemorySettings()
  const settings = await updateSettings({ memory: { ...current, ...patch } })
  return settings.memory as MemorySettings
}

export async function markMemoriesUsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const data = await load()
  const now = Date.now()
  const set = new Set(ids)
  for (const entry of data.entries) {
    if (set.has(entry.id)) entry.lastUsedAt = now
  }
  await persist()
}
