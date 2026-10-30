import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import type { Dirent } from 'fs'
import { execFile, spawn } from 'child_process'
import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'path'
import { promisify } from 'util'
import { getSettings, updateSettings } from './settings'
import { sessions } from './sessionRepository'
import { withAndroidPath } from './android'
import { extractPdfText } from './pdf'
import type {
  WorkspaceChange,
  WorkspaceCheckpoint,
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceInfo,
  WorkspaceRestoreResult,
  WorkspaceUndoResult
} from '../shared/types'

const execFileAsync = promisify(execFile)

const MAX_READ_BYTES = 512 * 1024
const MAX_WRITE_BYTES = 4 * 1024 * 1024
const MAX_TREE_ENTRIES = 1500
const MAX_GLOB_RESULTS = 400
const MAX_GREP_RESULTS = 200
const MAX_COMMAND_TIMEOUT = 300_000
const BACKUP_LIMIT = 120

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
  'vendor'
])

interface ChangeMeta {
  id: string
  root: string
  path: string
  action: 'write' | 'edit' | 'delete' | 'mkdir'
  at: number
  sessionId?: string
  checkpointId?: string
  existed: boolean
}

function backupRoot(): string {
  return join(app.getPath('userData'), 'workspace-backups')
}

function normalizeRel(input: string): string {
  const raw = String(input ?? '').replace(/\\/g, '/').trim()
  if (!raw || raw === '.' || raw === './') return '.'
  return raw.replace(/^\/+/, '').replace(/^\.\/+/, '')
}

function isGitPath(rel: string): boolean {
  return normalizeRel(rel)
    .split('/')
    .some((part) => part.toLowerCase() === '.git')
}

async function requireRoot(): Promise<string> {
  const root = await getWorkspaceRoot()
  if (!root) throw new Error('Çalışma alanı seçilmedi. Üst araç çubuğundan bir klasör seçin.')
  return root
}

let workspaceRootOverride: string | null | undefined

/**
 * Oturum kapsamlı çalışma alanı. Paralel sohbetler birbirinin klasörünü
 * ezmesin diye her ajan çalışması kendi köküyle bu bağlamda yürür.
 */
const workspaceScope = new AsyncLocalStorage<string | null>()

export function runWithWorkspace<T>(root: string | null, fn: () => T): T {
  return workspaceScope.run(root, fn)
}

export function currentWorkspaceScope(): string | null | undefined {
  return workspaceScope.getStore()
}

export function setWorkspaceRootOverride(root: string | null | undefined): void {
  workspaceRootOverride = root
}

export async function getWorkspaceRoot(): Promise<string | null> {
  const scoped = workspaceScope.getStore()
  if (scoped !== undefined) return scoped
  if (workspaceRootOverride !== undefined) return workspaceRootOverride
  const settings = await getSettings()
  const raw = settings.workspacePath
  if (!raw || typeof raw !== 'string') return null
  try {
    const real = await fs.realpath(raw)
    const stat = await fs.stat(real)
    return stat.isDirectory() ? real : null
  } catch {
    return null
  }
}

const TEMP_WORKSPACE_DIR = 'evren-workspaces'
const TEMP_WORKSPACE_MARKER = '.evren-workspace.json'
const TEMP_WORKSPACE_TTL_MS = 24 * 60 * 60 * 1000

function tempWorkspaceBase(): string {
  return join(app.getPath('temp'), TEMP_WORKSPACE_DIR)
}

export function isTemporaryWorkspacePath(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const base = resolve(tempWorkspaceBase())
    const target = resolve(value)
    const rel = relative(base, target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  } catch {
    return false
  }
}

async function tempWorkspaceAge(path: string): Promise<number> {
  try {
    const raw = await fs.readFile(join(path, TEMP_WORKSPACE_MARKER), 'utf8')
    const parsed = JSON.parse(raw) as { createdAt?: number }
    const createdAt = Number(parsed.createdAt)
    if (Number.isFinite(createdAt) && createdAt > 0) return Date.now() - createdAt
  } catch {
    // marker yoksa/bozuksa mtime kullan
  }
  try {
    const stat = await fs.stat(path)
    return Date.now() - stat.mtimeMs
  } catch {
    return 0
  }
}

/**
 * Yalnızca uygulamanın temp kökü altındaki, marker dosyası olan ve TTL'i
 * geçmiş geçici workspace'leri siler. Kullanıcı klasörlerine dokunmaz.
 */
export async function cleanupTemporaryWorkspaces(
  maxAgeMs = TEMP_WORKSPACE_TTL_MS
): Promise<number> {
  const base = tempWorkspaceBase()
  let entries: Dirent[]
  try {
    entries = await fs.readdir(base, { withFileTypes: true })
  } catch {
    return 0
  }

  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const target = join(base, entry.name)
    if ((await tempWorkspaceAge(target)) < maxAgeMs) continue
    try {
      await fs.access(join(target, TEMP_WORKSPACE_MARKER))
      await fs.rm(target, { recursive: true, force: true })
      removed += 1
    } catch {
      // marker yoksa veya dosya kilitliyse dokunma
    }
  }
  return removed
}

export async function createTemporaryWorkspace(): Promise<WorkspaceInfo> {
  await cleanupTemporaryWorkspaces()
  const base = tempWorkspaceBase()
  await fs.mkdir(base, { recursive: true })
  const dir = join(base, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(dir, { recursive: false })
  await fs.writeFile(
    join(dir, TEMP_WORKSPACE_MARKER),
    JSON.stringify(
      {
        createdAt: Date.now(),
        app: 'evren-desktop',
        note: 'Temporary workspace created by EVREN Desktop'
      },
      null,
      2
    ),
    'utf8'
  )
  await updateSettings({ workspacePath: dir })
  return { path: dir, exists: true, temporary: true }
}

export async function setActiveWorkspacePath(
  path: string | null
): Promise<void> {
  await updateSettings({ workspacePath: path })
}

export async function deleteTemporaryWorkspace(path: string): Promise<boolean> {
  if (!isTemporaryWorkspacePath(path)) return false
  const target = resolve(path)
  try {
    await fs.access(join(target, TEMP_WORKSPACE_MARKER))
    await fs.rm(target, { recursive: true, force: true })
    const settings = await getSettings()
    if (settings.workspacePath && resolve(settings.workspacePath) === target) {
      await updateSettings({ workspacePath: null })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Ajan çalışırken workspace yoksa (silinmiş, taşınmış veya hiç seçilmemiş)
 * oturuma bağlı geçici bir workspace oluşturur. Böylece yerleşik dosya/kabuk
 * araçları hiçbir zaman sessizce kaybolmaz.
 */
export async function ensureAgentWorkspace(sessionId?: string): Promise<string | null> {
  const existing = await getWorkspaceRoot()
  if (existing) return existing

  const created = await createTemporaryWorkspace()
  if (!created.path) return null

  if (sessionId) {
    try {
      const store = await sessions()
      await store.patch(sessionId, {
        workspacePath: created.path,
        workspaceTemporary: true
      })
    } catch {
      // oturum yoksa ayar yine de yazıldı
    }
  }
  return created.path
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {  const settings = await getSettings()
  const root = await getWorkspaceRoot()
  return {
    path: root ?? settings.workspacePath ?? null,
    exists: !!root,
    temporary: isTemporaryWorkspacePath(root ?? settings.workspacePath ?? null)
  }
}

export async function setWorkspacePath(raw: string): Promise<WorkspaceInfo> {
  const value = String(raw ?? '').trim()
  if (!value) {
    await updateSettings({ workspacePath: null })
    return { path: null, exists: false }
  }
  const abs = resolve(value)
  const stat = await fs.stat(abs)
  if (!stat.isDirectory()) throw new Error('Seçilen yol bir klasör değil.')
  const real = await fs.realpath(abs)
  await updateSettings({ workspacePath: real })
  return { path: real, exists: true }
}

export async function clearWorkspacePath(): Promise<WorkspaceInfo> {
  const current = await getWorkspaceRoot()
  await updateSettings({ workspacePath: null })
  if (isTemporaryWorkspacePath(current) && current) {
    try {
      await fs.rm(current, { recursive: true, force: true })
    } catch {
      // kilitliyse TTL temizliğine bırak
    }
  }
  return { path: null, exists: false }
}

function resolveInside(root: string, relInput: string): string {
  const rel = normalizeRel(relInput)
  if (isGitPath(rel)) throw new Error('.git dizinine erişim engellendi.')
  const target = resolve(root, rel)
  const check = relative(root, target)
  if (check.startsWith('..') || isAbsolute(check)) {
    throw new Error('Çalışma alanı dışına erişim engellendi.')
  }
  return target
}

async function ensureRealInside(root: string, target: string): Promise<void> {
  let probe = target
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const real = await fs.realpath(probe)
  const check = relative(root, real)
  if (check.startsWith('..') || isAbsolute(check)) {
    throw new Error('Çalışma alanı dışına erişim engellendi (symlink).')
  }
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/') || '.'
}

function sortEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
  return left.name.localeCompare(right.name, 'tr')
}

export async function getWorkspaceTree(): Promise<WorkspaceEntry[]> {
  const root = await getWorkspaceRoot()
  if (!root) return []
  const base = root
  let count = 0

  async function walk(dir: string, depth: number): Promise<WorkspaceEntry[]> {
    if (depth > 8 || count >= MAX_TREE_ENTRIES) return []
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const result: WorkspaceEntry[] = []
    for (const entry of entries) {
      if (count >= MAX_TREE_ENTRIES) break
      if (IGNORED.has(entry.name)) continue
      const abs = join(dir, entry.name)
      const rel = toRel(base, abs)
      if (entry.isDirectory()) {
        count += 1
        result.push({
          path: rel,
          name: entry.name,
          type: 'dir',
          children: await walk(abs, depth + 1)
        })
      } else if (entry.isFile()) {
        count += 1
        let size: number | undefined
        try {
          size = (await fs.stat(abs)).size
        } catch {
          size = undefined
        }
        result.push({ path: rel, name: entry.name, type: 'file', size })
      }
    }
    return result.sort(sortEntries)
  }

  return walk(base, 0)
}

export async function readWorkspaceFile(
  rawPath: string,
  offset?: number,
  limit?: number
): Promise<WorkspaceFileContent> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  await ensureRealInside(root, abs)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('Yol bir dosya değil.')
  const actualSize = stat.size
  const buffer = await fs.readFile(abs)
  const slice = buffer.subarray(0, MAX_READ_BYTES)
  const binary = slice.includes(0)
  let content = binary ? '[ikili dosya — metin olarak gösterilemiyor]' : slice.toString('utf8')
  const truncated = actualSize > slice.length

  if (!binary) {
    const startLine = Math.max(1, Math.round(Number(offset) || 1))
    const maxLines = Math.max(1, Math.min(4000, Math.round(Number(limit) || 4000)))
    if (offset !== undefined && startLine > 1) {
      const lines = content.split(/\r?\n/)
      content = lines.slice(startLine - 1, startLine - 1 + maxLines).join('\n')
    } else if (content.split(/\r?\n/).length > maxLines) {
      content = content.split(/\r?\n/).slice(0, maxLines).join('\n')
    }
  }

  return {
    path: toRel(root, abs),
    content,
    size: actualSize,
    truncated,
    binary
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export async function readWorkspaceImage(
  rawPath: string
): Promise<{ path: string; size: number; mime: string; dataUrl: string }> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  await ensureRealInside(root, abs)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('Yol bir dosya değil.')
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Görsel çok büyük (10 MB sınırı).')
  const mime = IMAGE_MIME[extname(abs).toLowerCase()]
  if (!mime) throw new Error('Desteklenmeyen görsel türü (PNG/JPEG/GIF/WebP).')
  const buffer = await fs.readFile(abs)
  return {
    path: toRel(root, abs),
    size: stat.size,
    mime,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
  }
}

export async function readWorkspacePdf(
  rawPath: string
): Promise<{ path: string; size: number; text: string }> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  await ensureRealInside(root, abs)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('Yol bir dosya değil.')
  if (extname(abs).toLowerCase() !== '.pdf') throw new Error('Dosya PDF değil.')
  const buffer = await fs.readFile(abs)
  return {
    path: toRel(root, abs),
    size: stat.size,
    text: await extractPdfText(buffer)
  }
}

async function readExistingText(abs: string): Promise<string | null> {
  try {
    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error('Yol bir dosya değil.')
    if (stat.size > MAX_WRITE_BYTES) throw new Error('Dosya çok büyük (4 MB sınırı).')
    const buffer = await fs.readFile(abs)
    if (buffer.includes(0)) throw new Error('İkili dosyalar düzenlenemez.')
    return buffer.toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/* -------------------- yedek / diff -------------------- */

function splitLines(value: string): string[] {
  if (!value) return []
  return value.replace(/\r\n/g, '\n').split('\n')
}

function unifiedDiff(before: string, after: string, rel: string, existed: boolean): string {
  if (before === after) return ''
  const a = splitLines(before)
  const b = splitLines(after)
  const n = a.length
  const m = b.length
  const from = existed ? `a/${rel}` : '/dev/null'
  const to = `b/${rel}`
  const header = `--- ${from}\n+++ ${to}\n`

  if (n * m > 4_000_000) {
    return `${header}@@ dosya değişti @@\n- ${n} satır önce\n+ ${m} satır sonra\n`
  }

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  type Op = {
    type: 'eq' | 'del' | 'add'
    line: string
    aLine?: number
    bLine?: number
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  let aLine = 1
  let bLine = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i], aLine, bLine })
      i += 1
      j += 1
      aLine += 1
      bLine += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', line: a[i], aLine })
      i += 1
      aLine += 1
    } else {
      ops.push({ type: 'add', line: b[j], bLine })
      j += 1
      bLine += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'del', line: a[i], aLine })
    i += 1
    aLine += 1
  }
  while (j < m) {
    ops.push({ type: 'add', line: b[j], bLine })
    j += 1
    bLine += 1
  }

  const changed = ops
    .map((op, index) => (op.type === 'eq' ? -1 : index))
    .filter((index) => index >= 0)
  if (changed.length === 0) return ''

  const ranges: Array<[number, number]> = []
  let start = Math.max(0, changed[0] - 3)
  let end = Math.min(ops.length - 1, changed[0] + 3)
  for (const index of changed.slice(1)) {
    if (index <= end + 6) {
      end = Math.min(ops.length - 1, index + 3)
    } else {
      ranges.push([start, end])
      start = Math.max(0, index - 3)
      end = Math.min(ops.length - 1, index + 3)
    }
  }
  ranges.push([start, end])

  let output = header
  for (const [rangeStart, rangeEnd] of ranges) {
    const slice = ops.slice(rangeStart, rangeEnd + 1)
    const firstA = slice.find((op) => op.aLine !== undefined)?.aLine ?? 0
    const firstB = slice.find((op) => op.bLine !== undefined)?.bLine ?? 0
    const aCount = slice.filter((op) => op.type !== 'add').length
    const bCount = slice.filter((op) => op.type !== 'del').length
    output += `@@ -${firstA},${aCount} +${firstB},${bCount} @@\n`
    for (const op of slice) {
      const marker = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '
      output += `${marker}${op.line}\n`
    }
  }
  return output
}

async function pruneBackups(): Promise<void> {
  const root = backupRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(root)
  } catch {
    return
  }
  if (dirs.length <= BACKUP_LIMIT) return
  const items: Array<{ dir: string; at: number }> = []
  for (const dir of dirs) {
    try {
      const meta = JSON.parse(
        await fs.readFile(join(root, dir, 'meta.json'), 'utf8')
      ) as ChangeMeta
      items.push({ dir, at: meta.at })
    } catch {
      // yoksay
    }
  }
  items.sort((left, right) => left.at - right.at)
  for (const item of items.slice(0, Math.max(0, items.length - BACKUP_LIMIT))) {
    await fs.rm(join(root, item.dir), { recursive: true, force: true }).catch(() => undefined)
  }
}

async function snapshot(
  root: string,
  rel: string,
  before: string | null,
  action: ChangeMeta['action'],
  sessionId?: string,
  checkpointId?: string
): Promise<ChangeMeta> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const dir = join(backupRoot(), id)
  await fs.mkdir(dir, { recursive: true })
  if (before !== null) {
    await fs.writeFile(join(dir, 'before.txt'), before, 'utf8')
  }
  const meta: ChangeMeta = {
    id,
    root,
    path: rel,
    action,
    at: Date.now(),
    sessionId,
    checkpointId,
    existed: before !== null
  }
  await fs.writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  await pruneBackups()
  return meta
}

export async function listWorkspaceChanges(limit = 40): Promise<WorkspaceChange[]> {
  const root = await getWorkspaceRoot()
  const backupDir = backupRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(backupDir)
  } catch {
    return []
  }
  const items: WorkspaceChange[] = []
  for (const dir of dirs) {
    try {
      const meta = JSON.parse(
        await fs.readFile(join(backupDir, dir, 'meta.json'), 'utf8')
      ) as ChangeMeta
      if (!root || meta.root !== root) continue
      let before = ''
      try {
        before = await fs.readFile(join(backupDir, dir, 'before.txt'), 'utf8')
      } catch {
        before = ''
      }
      let after = ''
      try {
        after = await fs.readFile(resolveInside(root, meta.path), 'utf8')
      } catch {
        after = ''
      }
      items.push({
        id: meta.id,
        path: meta.path,
        action: meta.action,
        at: meta.at,
        diff: unifiedDiff(before, after, meta.path, meta.existed),
        sessionId: meta.sessionId,
        checkpointId: meta.checkpointId,
        existed: meta.existed
      })
    } catch {
      // bozuk kaydı yoksay
    }
  }
  return items.sort((left, right) => right.at - left.at).slice(0, limit)
}

async function readChangeMeta(
  backupDir: string,
  dir: string,
  root: string
): Promise<{ dir: string; meta: ChangeMeta; before: string; after: string } | null> {
  try {
    const meta = JSON.parse(
      await fs.readFile(join(backupDir, dir, 'meta.json'), 'utf8')
    ) as ChangeMeta
    if (meta.root !== root) return null
    let before = ''
    try {
      before = await fs.readFile(join(backupDir, dir, 'before.txt'), 'utf8')
    } catch {
      before = ''
    }
    let after = ''
    try {
      after = await fs.readFile(resolveInside(root, meta.path), 'utf8')
    } catch {
      after = ''
    }
    return { dir, meta, before, after }
  } catch {
    return null
  }
}

export async function listWorkspaceCheckpoints(limit = 40): Promise<WorkspaceCheckpoint[]> {
  const root = await getWorkspaceRoot()
  if (!root) return []
  const backupDir = backupRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(backupDir)
  } catch {
    return []
  }

  const groups = new Map<
    string,
    { at: number; sessionId?: string; changes: WorkspaceChange[] }
  >()
  for (const dir of dirs) {
    const record = await readChangeMeta(backupDir, dir, root)
    if (!record) continue
    const key = record.meta.checkpointId ?? record.meta.id
    const change: WorkspaceChange = {
      id: record.meta.id,
      path: record.meta.path,
      action: record.meta.action,
      at: record.meta.at,
      diff: unifiedDiff(record.before, record.after, record.meta.path, record.meta.existed),
      sessionId: record.meta.sessionId,
      checkpointId: key,
      existed: record.meta.existed
    }
    const group = groups.get(key)
    if (group) {
      group.changes.push(change)
      group.at = Math.max(group.at, record.meta.at)
    } else {
      groups.set(key, {
        at: record.meta.at,
        sessionId: record.meta.sessionId,
        changes: [change]
      })
    }
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      at: group.at,
      sessionId: group.sessionId,
      files: [...new Set(group.changes.map((change) => change.path))],
      diff: group.changes
        .map((change) => change.diff)
        .filter(Boolean)
        .join('\n'),
      changes: group.changes.sort((left, right) => left.at - right.at)
    }))
    .sort((left, right) => right.at - left.at)
    .slice(0, limit)
}

export async function restoreWorkspaceCheckpoint(id: string): Promise<WorkspaceRestoreResult> {
  const root = await requireRoot()
  const backupDir = backupRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(backupDir)
  } catch {
    throw new Error('Geri alınacak adım bulunamadı.')
  }

  const records: Array<{ dir: string; meta: ChangeMeta; before: string }> = []
  for (const dir of dirs) {
    const record = await readChangeMeta(backupDir, dir, root)
    if (!record) continue
    const key = record.meta.checkpointId ?? record.meta.id
    if (key === id) records.push({ dir, meta: record.meta, before: record.before })
  }
  if (records.length === 0) throw new Error('Geri alınacak adım bulunamadı.')

  // Aynı dosyada birden fazla değişiklik varsa en yeniden eskiye doğru geri al.
  records.sort((left, right) => right.meta.at - left.meta.at)
  for (const record of records) {
    const abs = resolveInside(root, record.meta.path)
    if (record.meta.action === 'mkdir') {
      await fs.rmdir(abs).catch(() => undefined)
    } else if (record.meta.existed) {
      await fs.mkdir(dirname(abs), { recursive: true })
      await fs.writeFile(abs, record.before, 'utf8')
    } else {
      await fs.rm(abs, { force: true })
    }
  }
  for (const record of records) {
    await fs.rm(join(backupDir, record.dir), { recursive: true, force: true }).catch(() => undefined)
  }

  return {
    id,
    files: new Set(records.map((record) => record.meta.path)).size,
    restored: true
  }
}

export async function undoWorkspaceChange(id?: string): Promise<WorkspaceUndoResult> {
  const root = await requireRoot()
  const backupDir = backupRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(backupDir)
  } catch {
    throw new Error('Geri alınacak değişiklik yok.')
  }
  const metas: Array<{ dir: string; meta: ChangeMeta }> = []
  for (const dir of dirs) {
    try {
      const meta = JSON.parse(
        await fs.readFile(join(backupDir, dir, 'meta.json'), 'utf8')
      ) as ChangeMeta
      if (meta.root === root) metas.push({ dir, meta })
    } catch {
      // yoksay
    }
  }
  metas.sort((left, right) => right.meta.at - left.meta.at)
  const target = id ? metas.find((item) => item.meta.id === id) : metas[0]
  if (!target) throw new Error('Geri alınacak değişiklik bulunamadı.')

  const abs = resolveInside(root, target.meta.path)
  if (target.meta.action === 'mkdir') {
    await fs.rmdir(abs).catch(() => undefined)
  } else if (target.meta.existed) {
    const before = await fs.readFile(join(backupDir, target.dir, 'before.txt'), 'utf8')
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, before, 'utf8')
  } else {
    await fs.rm(abs, { force: true })
  }
  await fs.rm(join(backupDir, target.dir), { recursive: true, force: true })
  return { id: target.meta.id, path: target.meta.path, restored: true }
}

/* -------------------- yazma / düzenleme -------------------- */

export interface WorkspaceWriteResult {
  path: string
  bytes: number
  diff: string
  action: 'write' | 'edit' | 'delete' | 'mkdir'
  checkpointId?: string
}

export async function writeWorkspaceFile(
  rawPath: string,
  content: string,
  sessionId?: string,
  checkpointId?: string
): Promise<WorkspaceWriteResult> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  const rel = toRel(root, abs)
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error('İçerik çok büyük (4 MB sınırı).')
  }
  const before = await readExistingText(abs)
  await fs.mkdir(dirname(abs), { recursive: true })
  await ensureRealInside(root, abs)
  const meta = await snapshot(root, rel, before, 'write', sessionId, checkpointId)
  await fs.writeFile(abs, content, 'utf8')
  return {
    path: rel,
    bytes: Buffer.byteLength(content, 'utf8'),
    diff: unifiedDiff(before ?? '', content, rel, before !== null),
    action: 'write',
    checkpointId: meta.checkpointId ?? meta.id
  }
}

export async function editWorkspaceFile(
  rawPath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  sessionId?: string,
  checkpointId?: string
): Promise<WorkspaceWriteResult> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  const rel = toRel(root, abs)
  if (!oldString) throw new Error('old_string boş olamaz.')
  const before = await readExistingText(abs)
  if (before === null) throw new Error(`Dosya bulunamadı: ${rel}`)

  const occurrences = before.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error(
      `old_string dosyada bulunamadı. Önce read_file ile dosyayı okuyup birebir eşleşen metin ver.`
    )
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `old_string ${occurrences} kez geçiyor. Daha fazla bağlam ekle veya replace_all=true kullan.`
    )
  }
  const after = replaceAll
    ? before.split(oldString).join(newString)
    : before.replace(oldString, () => newString)
  if (Buffer.byteLength(after, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error('Sonuç çok büyük (4 MB sınırı).')
  }
  const meta = await snapshot(root, rel, before, 'edit', sessionId, checkpointId)
  await fs.writeFile(abs, after, 'utf8')
  return {
    path: rel,
    bytes: Buffer.byteLength(after, 'utf8'),
    diff: unifiedDiff(before, after, rel, true),
    action: 'edit',
    checkpointId: meta.checkpointId ?? meta.id
  }
}

export async function deleteWorkspaceFile(
  rawPath: string,
  sessionId?: string,
  checkpointId?: string
): Promise<WorkspaceWriteResult> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  const rel = toRel(root, abs)
  const before = await readExistingText(abs)
  if (before === null) throw new Error(`Dosya bulunamadı: ${rel}`)
  const meta = await snapshot(root, rel, before, 'delete', sessionId, checkpointId)
  await fs.rm(abs, { force: true })
  return {
    path: rel,
    bytes: 0,
    diff: unifiedDiff(before, '', rel, true),
    action: 'delete',
    checkpointId: meta.checkpointId ?? meta.id
  }
}

export async function makeWorkspaceDirectory(
  rawPath: string,
  sessionId?: string,
  checkpointId?: string
): Promise<WorkspaceWriteResult> {
  const root = await requireRoot()
  const abs = resolveInside(root, rawPath)
  const rel = toRel(root, abs)
  await fs.mkdir(abs, { recursive: true })
  const meta = await snapshot(root, rel, null, 'mkdir', sessionId, checkpointId)
  return {
    path: rel,
    bytes: 0,
    diff: '',
    action: 'mkdir',
    checkpointId: meta.checkpointId ?? meta.id
  }
}

/* -------------------- arama -------------------- */

function globToRegExp(pattern: string): RegExp {
  const clean = normalizeRel(pattern)
  let output = ''
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    if (char === '*') {
      if (clean[index + 1] === '*') {
        index += 1
        if (clean[index + 1] === '/') {
          index += 1
          output += '(?:.*/)?'
        } else {
          output += '.*'
        }
      } else {
        output += '[^/]*'
      }
    } else if (char === '?') {
      output += '[^/]'
    } else if ('+.^${}()|[]'.includes(char)) {
      output += `\\${char}`
    } else {
      output += char
    }
  }
  return new RegExp(`^${output}$`, 'i')
}

async function walkFiles(root: string, dir = root, depth = 0): Promise<string[]> {
  if (depth > 10) return []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, abs, depth + 1)))
    } else if (entry.isFile()) {
      files.push(toRel(root, abs))
      if (files.length > 5000) return files
    }
  }
  return files
}

export async function globWorkspace(pattern: string, rawPath?: string): Promise<string[]> {
  const root = await requireRoot()
  const base = rawPath ? resolveInside(root, rawPath) : root
  const baseRel = toRel(root, base)
  const matcher = globToRegExp(pattern)
  const files = await walkFiles(root, base)
  return files
    .filter((file) => {
      const rel = baseRel === '.' ? file : file.slice(baseRel.length + 1)
      return matcher.test(rel) || matcher.test(basename(file))
    })
    .slice(0, MAX_GLOB_RESULTS)
}

export async function grepWorkspace(
  pattern: string,
  rawPath?: string,
  include?: string,
  ignoreCase = false
): Promise<string[]> {
  const root = await requireRoot()
  const base = rawPath ? resolveInside(root, rawPath) : root
  const matcher = include ? globToRegExp(include) : null
  let regex: RegExp
  try {
    regex = new RegExp(pattern, ignoreCase ? 'i' : '')
  } catch (error) {
    throw new Error(`Geçersiz düzenli ifade: ${error instanceof Error ? error.message : error}`)
  }
  const files = await walkFiles(root, base)
  const results: string[] = []
  for (const rel of files) {
    if (matcher && !matcher.test(basename(rel)) && !matcher.test(rel)) continue
    const abs = resolve(root, rel)
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile() || stat.size > 1024 * 1024) continue
      const buffer = await fs.readFile(abs)
      if (buffer.includes(0)) continue
      const lines = buffer.toString('utf8').replace(/\r\n/g, '\n').split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (regex.test(lines[index])) {
          results.push(`${rel}:${index + 1}: ${lines[index].slice(0, 300)}`)
          if (results.length >= MAX_GREP_RESULTS) return results
        }
      }
    } catch {
      // yoksay
    }
  }
  return results
}

/* -------------------- komut -------------------- */

export interface CommandResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number
  background?: boolean
  pid?: number
}

export async function runWorkspaceCommand(
  command: string,
  timeoutOrOptions?: number | { timeoutMs?: number; background?: boolean }
): Promise<CommandResult> {
  const root = await requireRoot()
  const options =
    typeof timeoutOrOptions === 'object' && timeoutOrOptions !== null
      ? timeoutOrOptions
      : { timeoutMs: timeoutOrOptions }
  const timeout = Math.min(
    MAX_COMMAND_TIMEOUT,
    Math.max(1000, Math.round(Number(options.timeoutMs) || 60_000))
  )
  const isWindows = process.platform === 'win32'
  const file = isWindows ? 'powershell.exe' : '/bin/sh'
  // Windows PowerShell varsayılan olarak OEM kod sayfasında (TR için cp857)
  // yazar; bu da Türkçe karakterlerin bozulmasına yol açar. UTF-8'e zorluyoruz.
  const utf8Prefix = isWindows
    ? `$ProgressPreference='SilentlyContinue';` +
      `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);` +
      `$OutputEncoding=[System.Text.UTF8Encoding]::new($false);`
    : `export LC_ALL=C.UTF-8 LANG=C.UTF-8 2>/dev/null; `
  const effectiveCommand = `${utf8Prefix}${command}`
  const args = isWindows
    ? ['-NoProfile', '-NonInteractive', '-Command', effectiveCommand]
    : ['-c', effectiveCommand]
  const env = await withAndroidPath()

  if (options.background) {
    const child = spawn(file, args, {
      cwd: root,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    return {
      command,
      stdout: '',
      stderr: '',
      exitCode: 0,
      background: true,
      pid: child.pid
    }
  }

  try {
    const result = await execFileAsync(file, args, {
      cwd: root,
      env,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    })
    return {
      command,
      stdout: result.stdout.slice(0, 20_000),
      stderr: result.stderr.slice(0, 8_000),
      exitCode: 0
    }
  } catch (error) {
    const err = error as {
      stdout?: string
      stderr?: string
      code?: number | string
      message?: string
      killed?: boolean
    }
    return {
      command,
      stdout: String(err.stdout ?? '').slice(0, 20_000),
      stderr: String(err.stderr ?? err.message ?? '').slice(0, 8_000),
      exitCode: typeof err.code === 'number' ? err.code : err.killed ? 124 : 1
    }
  }
}
