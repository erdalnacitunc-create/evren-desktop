import { app } from 'electron'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { join, relative, sep } from 'path'
import type { CodeIndexStatus, CodeSearchResult } from '../shared/types'
import { loadApiKey } from './credentials'
import { embedTexts, EMBEDDING_MODEL } from './memory/embed'
import { listSourceFiles } from './repoMap'
import { getSettings } from './settings'
import { getWorkspaceRoot } from './workspace'

interface CodeChunk {
  path: string
  startLine: number
  endLine: number
  text: string
  embedding: number[]
}

interface CodeIndexData {
  root: string
  createdAt: number
  model: string
  files: number
  chunks: CodeChunk[]
}

const CHUNK_LINES = 60
const CHUNK_OVERLAP = 12
const MAX_CHUNKS = 600
const MAX_FILE_BYTES = 512 * 1024
const MAX_CHUNK_CHARS = 2000
const BATCH_SIZE = 24

let cache: CodeIndexData | null = null

function indexPath(root: string): string {
  const key = createHash('sha256').update(root).digest('hex').slice(0, 20)
  return join(app.getPath('userData'), 'code-index', `${key}.json`)
}

function relativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

function chunkFile(path: string, content: string): CodeChunk[] {
  const lines = content.split(/\r?\n/)
  const chunks: CodeChunk[] = []
  const step = Math.max(1, CHUNK_LINES - CHUNK_OVERLAP)
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + CHUNK_LINES)
    const text = lines.slice(start, end).join('\n').trim()
    if (text.length < 40) continue
    chunks.push({
      path,
      startLine: start + 1,
      endLine: end,
      text: text.slice(0, MAX_CHUNK_CHARS),
      embedding: []
    })
    if (chunks.length >= MAX_CHUNKS) break
  }
  return chunks
}

async function loadIndex(root: string): Promise<CodeIndexData | null> {
  if (cache && cache.root === root) return cache
  try {
    const raw = await fs.readFile(indexPath(root), 'utf8')
    const parsed = JSON.parse(raw) as CodeIndexData
    if (!parsed || parsed.root !== root || !Array.isArray(parsed.chunks)) return null
    cache = parsed
    return parsed
  } catch {
    return null
  }
}

async function saveIndex(data: CodeIndexData): Promise<void> {
  const target = indexPath(data.root)
  await fs.mkdir(join(app.getPath('userData'), 'code-index'), { recursive: true })
  await fs.writeFile(target, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
  cache = data
}

export async function getCodeIndexStatus(): Promise<CodeIndexStatus> {
  const root = await getWorkspaceRoot()
  if (!root) return { root: '', indexed: false, files: 0, chunks: 0 }
  const data = await loadIndex(root)
  return data
    ? {
        root,
        indexed: true,
        files: data.files,
        chunks: data.chunks.length,
        createdAt: data.createdAt,
        model: data.model
      }
    : { root, indexed: false, files: 0, chunks: 0 }
}

export async function buildCodeIndex(): Promise<CodeIndexStatus> {
  const [root, key, settings] = await Promise.all([
    getWorkspaceRoot(),
    loadApiKey(),
    getSettings()
  ])
  if (!root) throw new Error('Çalışma alanı seçilmedi.')
  if (!key) throw new Error('API anahtarı bulunamadı.')

  const files = (await listSourceFiles()).slice(0, 500)
  if (files.length === 0) throw new Error('İndekslenecek kaynak dosya bulunamadı.')

  const chunks: CodeChunk[] = []
  let fileCount = 0
  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE_BYTES) continue
      const content = await fs.readFile(file, 'utf8')
      if (content.includes('\u0000')) continue
      const fileChunks = chunkFile(relativePath(root, file), content)
      if (fileChunks.length > 0) {
        fileCount += 1
        chunks.push(...fileChunks)
      }
      if (chunks.length >= MAX_CHUNKS) break
    } catch {
      // okunamayan dosyayı atla
    }
  }

  if (chunks.length === 0) throw new Error('İndekslenecek kod parçası bulunamadı.')

  for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + BATCH_SIZE)
    const embeddings = await embedTexts(
      settings.baseUrl,
      key,
      batch.map((chunk) => `${chunk.path}\n${chunk.text}`)
    )
    if (embeddings.length !== batch.length) {
      throw new Error('Embedding yanıtı beklenen sayıda değil.')
    }
    batch.forEach((chunk, index) => {
      chunk.embedding = embeddings[index] ?? []
    })
  }

  const data: CodeIndexData = {
    root,
    createdAt: Date.now(),
    model: EMBEDDING_MODEL,
    files: fileCount,
    chunks: chunks.slice(0, MAX_CHUNKS)
  }
  await saveIndex(data)
  return {
    root,
    indexed: true,
    files: data.files,
    chunks: data.chunks.length,
    createdAt: data.createdAt,
    model: data.model
  }
}

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export async function searchCodeIndex(
  query: string,
  topK = 8
): Promise<CodeSearchResult[]> {
  const text = String(query ?? '').trim()
  if (!text) throw new Error('Arama sorgusu boş olamaz.')
  const root = await getWorkspaceRoot()
  if (!root) throw new Error('Çalışma alanı seçilmedi.')
  const data = await loadIndex(root)
  if (!data) {
    throw new Error('Anlamsal kod indeksi yok. Dosyalar > Ara panelinden indeks oluşturun.')
  }
  const [key, settings] = await Promise.all([loadApiKey(), getSettings()])
  if (!key) throw new Error('API anahtarı bulunamadı.')
  const [embedding] = await embedTexts(settings.baseUrl, key, [text])
  if (!embedding || embedding.length === 0) throw new Error('Sorgu embeddingi alınamadı.')

  return data.chunks
    .map((chunk) => ({
      chunk,
      score: cosine(embedding, chunk.embedding)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(30, Math.round(topK))))
    .map(({ chunk, score }) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score,
      preview: chunk.text.slice(0, 500)
    }))
}
