import { execFile } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import { app } from 'electron'
import { basename, dirname, join, resolve } from 'path'
import { promisify } from 'util'
import type {
  GitCommandResult,
  GitFile,
  GitGhStatus,
  GitPrCheck,
  GitPrInfo,
  GitPrStatus,
  GitPushResult,
  GitRemote,
  GitStatus,
  GitWorktree,
  GitWorktreeAddResult
} from '../shared/types'
import { loadGithubToken } from './credentials'
import { getGithubAppToken } from './githubApp'
import { getWorkspaceRoot } from './workspace'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT = 200_000

interface GitRun {
  code: number
  stdout: string
  stderr: string
  error?: string
}

async function git(root: string, args: string[], timeout = 45_000): Promise<GitRun> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: root,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    })
    return {
      code: 0,
      stdout: String(result.stdout ?? '').slice(0, MAX_OUTPUT),
      stderr: String(result.stderr ?? '').slice(0, MAX_OUTPUT)
    }
  } catch (error) {
    const err = error as {
      code?: number | string
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout ?? '').slice(0, MAX_OUTPUT),
      stderr: String(err.stderr ?? '').slice(0, MAX_OUTPUT),
      error: err.message ?? String(error)
    }
  }
}

function friendlyGitError(run: GitRun): string {
  if (run.error?.includes('ENOENT')) {
    return 'Git bulunamadı. Git for Windows kurulu ve PATH içinde olmalı.'
  }
  return (run.stderr || run.stdout || run.error || 'Git komutu başarısız oldu.').trim()
}

export async function getGitStatus(): Promise<GitStatus> {
  const workspace = await getWorkspaceRoot()
  if (!workspace) {
    return { isRepo: false, branch: '', files: [], clean: true }
  }

  const rootCheck = await git(workspace, ['rev-parse', '--show-toplevel'])
  if (rootCheck.code !== 0) {
    return { isRepo: false, branch: '', files: [], clean: true }
  }
  const repoRoot = rootCheck.stdout.trim()

  const branchResult = await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = branchResult.stdout.trim() || 'HEAD'
  const statusResult = await git(repoRoot, ['status', '--porcelain=v1'])
  if (statusResult.code !== 0) {
    return {
      isRepo: true,
      branch,
      files: [],
      clean: true,
      repoRoot,
      upstream: null
    }
  }

  const files: GitFile[] = []
  for (const line of statusResult.stdout.split(/\r?\n/)) {
    if (line.length < 4) continue
    const indexStatus = line[0] ?? ' '
    const worktreeStatus = line[1] ?? ' '
    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ').pop() ?? path
    files.push({
      path,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      untracked: indexStatus === '?'
    })
  }

  const upstreamRun = await git(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const upstream = upstreamRun.code === 0 ? upstreamRun.stdout.trim() : null
  let ahead = 0
  let behind = 0
  if (upstream) {
    const counts = await git(repoRoot, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
    if (counts.code === 0) {
      const [aheadValue, behindValue] = counts.stdout.trim().split(/\s+/)
      ahead = Number(aheadValue) || 0
      behind = Number(behindValue) || 0
    }
  }

  return {
    isRepo: true,
    branch,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    clean: files.length === 0,
    repoRoot,
    upstream,
    ahead,
    behind
  }
}

export async function getGitDiff(path?: string, staged = false): Promise<string> {
  const workspace = await getWorkspaceRoot()
  if (!workspace) throw new Error('Çalışma alanı seçilmedi.')
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  if (path) args.push('--', path)
  const result = await git(status.repoRoot, args)
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return result.stdout || '(fark yok)'
}

export async function stageGitPaths(paths?: string[]): Promise<GitCommandResult> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  const args = paths && paths.length > 0 ? ['add', '--', ...paths] : ['add', '-A']
  const result = await git(status.repoRoot, args)
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return { ok: true, output: result.stdout || 'Değişiklikler stage edildi.' }
}

export async function unstageGitPaths(paths?: string[]): Promise<GitCommandResult> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  const args =
    paths && paths.length > 0 ? ['reset', 'HEAD', '--', ...paths] : ['reset', 'HEAD']
  const result = await git(status.repoRoot, args)
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return { ok: true, output: result.stdout || 'Stage geri alındı.' }
}

export async function commitGit(message: string): Promise<GitCommandResult> {
  const text = String(message ?? '').trim()
  if (!text) throw new Error('Commit mesajı boş olamaz.')
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  const result = await git(status.repoRoot, ['commit', '-m', text])
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return { ok: true, output: result.stdout || 'Commit oluşturuldu.' }
}

export async function listGitBranches(): Promise<string[]> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) return []
  const result = await git(status.repoRoot, ['branch', '--format=%(refname:short)'])
  if (result.code !== 0) return []
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function listGitWorktrees(): Promise<GitWorktree[]> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) return []
  const result = await git(status.repoRoot, ['worktree', 'list', '--porcelain'])
  if (result.code !== 0) return []

  const worktrees: GitWorktree[] = []
  let current: Partial<GitWorktree> = {}
  const flush = (): void => {
    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? 'detached',
        head: current.head,
        isMain: worktrees.length === 0
      })
    }
    current = {}
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length)
    else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  flush()
  return worktrees
}

function safeSegment(value: string): string {
  return (
    String(value ?? '')
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'worktree'
  )
}

export async function addGitWorktree(requestedBranch: string): Promise<GitWorktreeAddResult> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')

  const branch = String(requestedBranch ?? '').trim()
  if (!branch) throw new Error('Worktree için bir branch adı girin.')
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) {
    throw new Error('Geçersiz branch adı.')
  }

  const repoRoot = status.repoRoot
  const parent = join(dirname(repoRoot), `${basename(repoRoot)}-worktrees`)
  const target = resolve(parent, safeSegment(branch))
  try {
    await fs.access(target)
    throw new Error(`Worktree yolu zaten var: ${target}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Worktree yolu')) throw error
  }
  await fs.mkdir(parent, { recursive: true })

  const branches = await listGitBranches()
  const exists = branches.includes(branch)
  const args = exists
    ? ['worktree', 'add', target, branch]
    : ['worktree', 'add', '-b', branch, target, 'HEAD']
  const result = await git(repoRoot, args)
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return { path: target, branch, output: result.stdout || 'Worktree oluşturuldu.' }
}

export async function removeGitWorktree(pathValue: string): Promise<GitCommandResult> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  const target = resolve(String(pathValue ?? ''))
  const worktrees = await listGitWorktrees()
  const found = worktrees.find((worktree) => resolve(worktree.path) === target)
  if (!found) throw new Error('Worktree bulunamadı.')
  if (found.isMain) throw new Error('Ana çalışma ağacı kaldırılamaz.')
  const result = await git(status.repoRoot, ['worktree', 'remove', '--force', target])
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return { ok: true, output: result.stdout || 'Worktree kaldırıldı.' }
}

async function gh(root: string, args: string[], timeout = 60_000): Promise<GitRun> {
  const bundled = join(app.getPath('userData'), 'bin', 'gh.exe')
  const fallbackBundled = join(app.getPath('userData'), 'bin', 'bin', 'gh.exe')
  const executable = existsSync(bundled)
    ? bundled
    : existsSync(fallbackBundled)
      ? fallbackBundled
      : 'gh'
  const appToken = await getGithubAppToken().catch(() => null)
  const token = appToken ?? (await loadGithubToken())
  try {
    const result = await execFileAsync(executable, args, {
      cwd: root,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        ...(token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {})
      }
    })
    return {
      code: 0,
      stdout: String(result.stdout ?? '').slice(0, MAX_OUTPUT),
      stderr: String(result.stderr ?? '').slice(0, MAX_OUTPUT)
    }
  } catch (error) {
    const err = error as {
      code?: number | string
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout ?? '').slice(0, MAX_OUTPUT),
      stderr: String(err.stderr ?? '').slice(0, MAX_OUTPUT),
      error: err.message ?? String(error)
    }
  }
}

export async function listGitRemotes(): Promise<GitRemote[]> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) return []
  const result = await git(status.repoRoot, ['remote', '-v'])
  if (result.code !== 0) return []
  const remotes = new Map<string, string>()
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (match && !remotes.has(match[1])) remotes.set(match[1], match[2])
  }
  return [...remotes.entries()].map(([name, url]) => ({ name, url }))
}

export async function pushGit(remote?: string): Promise<GitPushResult> {
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  if (!status.branch || status.branch === 'HEAD') {
    throw new Error('Detached HEAD durumunda push yapılamaz; önce bir branch seçin.')
  }
  const remotes = await listGitRemotes()
  if (remotes.length === 0) {
    throw new Error('Tanımlı Git remote yok. Önce bir origin ekleyin.')
  }
  const remoteName = remote?.trim() || (remotes.find((item) => item.name === 'origin')?.name ?? remotes[0].name)
  if (!remotes.some((item) => item.name === remoteName)) {
    throw new Error(`Remote bulunamadı: ${remoteName}`)
  }
  const result = await git(status.repoRoot, ['push', '-u', remoteName, status.branch])
  if (result.code !== 0) throw new Error(friendlyGitError(result))
  return {
    remote: remoteName,
    branch: status.branch,
    output: result.stdout || result.stderr || 'Push tamamlandı.'
  }
}

export async function getGhStatus(): Promise<GitGhStatus> {
  const status = await getGitStatus()
  const cwd = status.repoRoot ?? (await getWorkspaceRoot()) ?? process.cwd()
  const version = await gh(cwd, ['--version'])
  if (version.code !== 0) {
    return {
      available: false,
      authenticated: false,
      error: version.error?.includes('ENOENT')
        ? 'GitHub CLI (gh) bulunamadı. https://cli.github.com adresinden kurun.'
        : version.stderr || version.error || 'GitHub CLI kontrol edilemedi.'
    }
  }
  const auth = await gh(cwd, ['auth', 'status'])
  return {
    available: true,
    authenticated: auth.code === 0,
    error:
      auth.code === 0
        ? undefined
        : auth.stderr || auth.stdout || 'GitHub CLI oturumu yok. `gh auth login` çalıştırın.',
    version: version.stdout.split(/\r?\n/)[0]
  }
}

export async function createGitPr(title: string, body?: string): Promise<GitCommandResult> {
  const text = String(title ?? '').trim()
  if (!text) throw new Error('PR başlığı boş olamaz.')
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) throw new Error('Çalışma alanı bir Git deposu değil.')
  const ghStatus = await getGhStatus()
  if (!ghStatus.available) throw new Error(ghStatus.error ?? 'GitHub CLI bulunamadı.')
  if (!ghStatus.authenticated) throw new Error(ghStatus.error ?? 'GitHub CLI oturumu gerekli.')
  const args = ['pr', 'create', '--title', text]
  const bodyText = String(body ?? '').trim()
  if (bodyText) args.push('--body', bodyText)
  const result = await gh(status.repoRoot, args)
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || result.error || 'PR oluşturulamadı.')
  }
  return { ok: true, output: result.stdout || 'PR oluşturuldu.' }
}

export async function getGitPrStatus(): Promise<GitPrStatus> {
  const ghStatus = await getGhStatus()
  if (!ghStatus.available || !ghStatus.authenticated) {
    return {
      available: ghStatus.available,
      authenticated: ghStatus.authenticated,
      pr: null,
      error: ghStatus.error
    }
  }
  const status = await getGitStatus()
  if (!status.isRepo || !status.repoRoot) {
    return { available: true, authenticated: true, pr: null, error: 'Git deposu değil.' }
  }
  const result = await gh(status.repoRoot, [
    'pr',
    'view',
    '--json',
    'number,title,url,state,statusCheckRollup'
  ])
  if (result.code !== 0) {
    const message = (result.stderr || result.stdout || '').trim()
    return {
      available: true,
      authenticated: true,
      pr: null,
      error: /no pull requests|not found/i.test(message)
        ? 'Bu branch için açık PR yok.'
        : message || 'PR durumu alınamadı.'
    }
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      number?: number
      title?: string
      url?: string
      state?: string
      statusCheckRollup?: Array<{
        name?: string
        context?: string
        status?: string
        state?: string
        conclusion?: string
        detailsUrl?: string
        targetUrl?: string
      }>
    }
    const checks: GitPrCheck[] = (parsed.statusCheckRollup ?? []).map((check) => ({
      name: check.name ?? check.context ?? 'check',
      status: check.status ?? check.state ?? 'UNKNOWN',
      conclusion: check.conclusion,
      url: check.detailsUrl ?? check.targetUrl
    }))
    const pr: GitPrInfo = {
      number: parsed.number ?? 0,
      title: parsed.title ?? '',
      url: parsed.url ?? '',
      state: parsed.state ?? 'OPEN',
      checks
    }
    return { available: true, authenticated: true, pr }
  } catch {
    return { available: true, authenticated: true, pr: null, error: 'PR yanıtı okunamadı.' }
  }
}
