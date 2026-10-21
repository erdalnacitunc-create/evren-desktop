import { promises as fs } from 'fs'
import type { Dirent } from 'fs'
import { extname, join, relative, sep } from 'path'
import { getWorkspaceRoot } from './workspace'
import type { RepoMapResult } from '../shared/types'

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'coverage',
  'target',
  'vendor',
  'bin',
  'obj'
])

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.kts'
])

const MAX_FILES = 600
const MAX_FILE_BYTES = 512 * 1024
const MAX_SYMBOLS_PER_FILE = 100
const MAX_OUTPUT = 60_000

interface SymbolInfo {
  name: string
  kind: string
  line: number
}

interface RepoMapFile {
  path: string
  symbols: SymbolInfo[]
}

function relativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

async function collectFiles(root: string, dir = root, depth = 0): Promise<string[]> {
  if (depth > 12) return []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, abs, depth + 1)))
      if (files.length >= MAX_FILES) return files
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(abs)
      if (files.length >= MAX_FILES) return files
    }
  }
  return files
}

function pushSymbol(
  symbols: SymbolInfo[],
  seen: Set<string>,
  name: string,
  kind: string,
  line: number
): void {
  const clean = name.trim()
  if (!clean) return
  const key = `${clean}:${line}:${kind}`
  if (seen.has(key)) return
  seen.add(key)
  symbols.push({ name: clean.slice(0, 120), kind, line })
}

function extractSymbols(extension: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = []
  const seen = new Set<string>()
  const lines = content.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break
    const line = lines[index]
    const lineNumber = index + 1
    if (!line.trim() || line.trimStart().startsWith('//') || line.trimStart().startsWith('#')) {
      continue
    }

    let match: RegExpExecArray | null = null

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(extension)) {
      match = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(
        line
      )
      if (match) {
        pushSymbol(symbols, seen, match[1], 'type/function', lineNumber)
        continue
      }
      match = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line)
      if (match) {
        pushSymbol(symbols, seen, match[1], 'value', lineNumber)
        continue
      }
      match = /^\s{0,4}(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::|\{)/.exec(
        line
      )
      if (match && !['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
        pushSymbol(symbols, seen, match[1], 'member', lineNumber)
      }
      continue
    }

    if (extension === '.py') {
      match = /^(?:class|def)\s+([A-Za-z_]\w*)/.exec(line)
      if (match) pushSymbol(symbols, seen, match[1], 'def/class', lineNumber)
      continue
    }

    if (extension === '.go') {
      match = /^(?:func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line)
      if (match) pushSymbol(symbols, seen, match[1], 'func/type', lineNumber)
      continue
    }

    if (extension === '.rs') {
      match = /^(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z_]\w*)/.exec(line)
      if (match) pushSymbol(symbols, seen, match[1], 'fn/type', lineNumber)
      continue
    }

    if (['.java', '.cs', '.kt', '.kts', '.swift'].includes(extension)) {
      match = /^(?:\s*(?:public|private|protected|internal|static|final|abstract|sealed|partial|open|data|enum|class|interface|record|fun|func|def)\s+)*([A-Za-z_]\w*)\s*(?:\(|:|<)/.exec(
        line
      )
      if (match) pushSymbol(symbols, seen, match[1], 'type/member', lineNumber)
      continue
    }

    if (['.c', '.h', '.cpp', '.hpp', '.cc'].includes(extension)) {
      match = /^(?:[A-Za-z_][\w:*&<>\s]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?/.exec(line)
      if (match) pushSymbol(symbols, seen, match[1], 'function', lineNumber)
      continue
    }

    if (['.rb', '.php'].includes(extension)) {
      match = /^(?:class|module|def|function)\s+([A-Za-z_]\w*)/.exec(line.trim())
      if (match) pushSymbol(symbols, seen, match[1], 'def/class', lineNumber)
    }
  }

  return symbols
}

export async function listSourceFiles(): Promise<string[]> {
  const root = await getWorkspaceRoot()
  if (!root) return []
  return collectFiles(root)
}

export async function buildRepoMap(
  query?: string,
  maxFiles = MAX_FILES
): Promise<RepoMapResult> {  const root = await getWorkspaceRoot()
  if (!root) throw new Error('Çalışma alanı seçilmedi.')
  const filePaths = (await collectFiles(root)).slice(0, Math.max(1, Math.min(MAX_FILES, maxFiles)))
  const files: RepoMapFile[] = []
  const needle = String(query ?? '').trim().toLowerCase()

  for (const file of filePaths) {
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE_BYTES) continue
      const content = await fs.readFile(file, 'utf8')
      const symbols = extractSymbols(extname(file).toLowerCase(), content)
      const path = relativePath(root, file)
      if (needle) {
        const pathMatch = path.toLowerCase().includes(needle)
        const symbolMatch = symbols.some((symbol) => symbol.name.toLowerCase().includes(needle))
        if (!pathMatch && !symbolMatch) continue
      }
      files.push({ path, symbols })
    } catch {
      // okunamayan dosyayı atla
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path))
  const lines: string[] = []
  let truncated = false
  let symbolCount = 0
  for (const file of files) {
    const header = file.path
    if (lines.join('\n').length + header.length > MAX_OUTPUT) {
      truncated = true
      break
    }
    lines.push(header)
    for (const symbol of file.symbols) {
      const row = `  ${symbol.line}: ${symbol.kind} ${symbol.name}`
      if (lines.join('\n').length + row.length > MAX_OUTPUT) {
        truncated = true
        break
      }
      lines.push(row)
      symbolCount += 1
    }
    if (truncated) break
  }

  return {
    root,
    text: lines.join('\n') || '(sembol bulunamadı)',
    fileCount: files.length,
    symbolCount,
    truncated
  }
}
