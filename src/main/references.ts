import { promises as fs } from 'fs'
import { extname, isAbsolute, relative, resolve, sep } from 'path'
import type { ReferenceDirectory } from '../shared/types'
import { getSettings } from './settings'
import { extractPdfText } from './pdf'

const MAX_READ_BYTES = 512 * 1024

export interface ReferenceInfo extends ReferenceDirectory {
  exists: boolean
}

export interface ReferenceReadResult {
  path: string
  content: string
  size: number
  binary: boolean
  truncated: boolean
}

function validName(name: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(name)
}

export async function listReferences(): Promise<ReferenceInfo[]> {
  const settings = await getSettings()
  const configured = Array.isArray(settings.references) ? settings.references : []
  const result: ReferenceInfo[] = []
  for (const item of configured) {
    if (!item || typeof item.name !== 'string' || typeof item.path !== 'string') continue
    const name = item.name.trim()
    const path = item.path.trim()
    if (!validName(name) || !path) continue
    let exists = false
    try {
      const real = await fs.realpath(path)
      const stat = await fs.stat(real)
      exists = stat.isDirectory()
      result.push({ name, path: real, exists })
    } catch {
      result.push({ name, path, exists })
    }
  }
  return result
}

async function inside(root: string, target: string): Promise<boolean> {
  const rel = relative(root, target)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export async function resolveReference(
  input: string
): Promise<{ name: string; root: string; path: string }> {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('Referans yolu boş.')
  const refs = (await listReferences()).filter((item) => item.exists)
  if (refs.length === 0) {
    throw new Error('Tanımlı referans klasörü yok. settings.json içindeki references alanını kullanın.')
  }

  let selected: ReferenceInfo | undefined
  let rel = ''
  const match = /^([a-zA-Z0-9_.-]+):(.*)$/.exec(raw)
  if (match) {
    selected = refs.find((item) => item.name === match[1])
    rel = match[2] ?? ''
  } else if (isAbsolute(raw)) {
    for (const item of refs) {
      const candidate = resolve(raw)
      const root = await fs.realpath(item.path)
      if (await inside(root, candidate)) {
        selected = { ...item, path: root }
        rel = relative(root, candidate)
        break
      }
    }
  } else {
    throw new Error('Referans için "isim:göreli/yol" veya izinli mutlak yol kullanın.')
  }
  if (!selected) throw new Error('Bu yol izinli referans klasörlerinde değil.')

  const root = await fs.realpath(selected.path)
  const target = resolve(root, rel || '.')
  if (!(await inside(root, target))) throw new Error('Referans klasörü dışına erişim engellendi.')
  let realTarget: string
  try {
    realTarget = await fs.realpath(target)
  } catch {
    realTarget = target
  }
  if (!(await inside(root, realTarget))) {
    throw new Error('Symlink üzerinden referans dışına erişim engellendi.')
  }
  return { name: selected.name, root, path: realTarget }
}

export async function readReference(
  input: string,
  offset?: number,
  limit?: number
): Promise<ReferenceReadResult> {
  const resolved = await resolveReference(input)
  const stat = await fs.stat(resolved.path)
  if (!stat.isFile()) throw new Error('Referans yolu bir dosya değil.')
  const buffer = await fs.readFile(resolved.path)
  const slice = buffer.subarray(0, MAX_READ_BYTES)
  const binary = slice.includes(0)
  if (binary) {
    return {
      path: resolved.path,
      content: '[ikili dosya - metin olarak gösterilemiyor]',
      size: stat.size,
      binary: true,
      truncated: stat.size > slice.length
    }
  }
  let content = slice.toString('utf8')
  const startLine = Math.max(1, Math.round(Number(offset) || 1))
  const maxLines = Math.max(1, Math.min(4000, Math.round(Number(limit) || 800)))
  const lines = content.split(/\r?\n/)
  content = lines.slice(startLine - 1, startLine - 1 + maxLines).join('\n')
  return {
    path: resolved.path,
    content,
    size: stat.size,
    binary: false,
    truncated: stat.size > slice.length || startLine - 1 + maxLines < lines.length
  }
}

export async function readReferencePdf(
  input: string
): Promise<{ path: string; size: number; text: string }> {
  const resolved = await resolveReference(input)
  const stat = await fs.stat(resolved.path)
  if (!stat.isFile()) throw new Error('Referans yolu bir dosya değil.')
  if (extname(resolved.path).toLowerCase() !== '.pdf') throw new Error('Dosya PDF değil.')
  const buffer = await fs.readFile(resolved.path)
  return {
    path: resolved.path,
    size: stat.size,
    text: await extractPdfText(buffer)
  }
}

export async function listReferenceDirectory(
  input: string
): Promise<Array<{ path: string; name: string; type: 'file' | 'dir' }>> {
  const resolved = await resolveReference(input)
  const stat = await fs.stat(resolved.path)
  if (!stat.isDirectory()) throw new Error('Referans yolu bir klasör değil.')
  const entries = await fs.readdir(resolved.path, { withFileTypes: true })
  return entries
    .slice(0, 300)
    .map((entry) => ({
      path: relative(resolved.root, resolve(resolved.path, entry.name)).split(sep).join('/'),
      name: entry.name,
      type: entry.isDirectory() ? ('dir' as const) : ('file' as const)
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'tr') : a.type === 'dir' ? -1 : 1))
}
