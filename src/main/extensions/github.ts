import { promises as fs } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import * as tar from 'tar'

const API = 'https://api.github.com'
const MAX_TARBALL_BYTES = 80 * 1024 * 1024

export interface ParsedRepo {
  owner: string
  repo: string
  ref?: string
  path?: string
}

export interface RepoMetadata {
  owner: string
  repo: string
  fullName: string
  description?: string
  stars?: number
  license?: string
  defaultBranch: string
  htmlUrl: string
}

export function parseGitHubUrl(input: string): ParsedRepo | null {
  let raw = input.trim()
  if (!raw) return null

  let explicitPath = ''
  const pathIndex = raw.indexOf('::path:')
  if (pathIndex >= 0) {
    explicitPath = raw.slice(pathIndex + 7).replace(/^\/+/, '')
    raw = raw.slice(0, pathIndex)
  }

  let hashRef = ''
  const hashIndex = raw.indexOf('#')
  if (hashIndex >= 0) {
    hashRef = raw.slice(hashIndex + 1)
    raw = raw.slice(0, hashIndex)
  }

  raw = raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')

  const parts = raw.split('/').filter(Boolean)
  if (parts[0]?.toLowerCase() === 'github.com') parts.shift()
  if (parts.length < 2) return null

  const owner = parts[0]
  const repo = parts[1]
  let ref = hashRef || undefined
  let path = explicitPath || undefined

  if (parts[2] === 'tree' && parts[3]) {
    ref = decodeURIComponent(parts[3])
    if (parts.length > 4) path = parts.slice(4).join('/')
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null
  return { owner, repo, ref, path }
}

async function githubRequest<T>(
  path: string,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'evren-desktop'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API}${path}`, { headers })
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      'GitHub API istek limiti aşıldı. Ayarlardan bir GitHub token ekleyerek limiti yükseltebilirsiniz.'
    )
  }
  if (res.status === 404) {
    throw new Error('Repo bulunamadı veya erişim yok (404). Private repo için token gerekebilir.')
  }
  if (!res.ok) {
    throw new Error(`GitHub API hatası: HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token?: string
): Promise<RepoMetadata> {
  const data = await githubRequest<{
    full_name: string
    description?: string
    stargazers_count?: number
    license?: { spdx_id?: string; name?: string } | null
    default_branch?: string
    html_url?: string
  }>(`/repos/${owner}/${repo}`, token)

  return {
    owner,
    repo,
    fullName: data.full_name ?? `${owner}/${repo}`,
    description: data.description ?? undefined,
    stars: data.stargazers_count,
    license: data.license?.spdx_id ?? data.license?.name ?? undefined,
    defaultBranch: data.default_branch ?? 'main',
    htmlUrl: data.html_url ?? `https://github.com/${owner}/${repo}`
  }
}

export async function resolveCommit(
  owner: string,
  repo: string,
  ref: string,
  token?: string
): Promise<string> {
  const data = await githubRequest<{ sha: string }>(
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    token
  )
  if (!data.sha) throw new Error('Commit SHA çözümlenemedi.')
  return data.sha
}

export async function downloadTarball(
  owner: string,
  repo: string,
  commit: string
): Promise<Buffer> {
  const res = await fetch(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(commit)}`,
    { headers: { 'User-Agent': 'evren-desktop' } }
  )
  if (!res.ok) throw new Error(`Repo arşivi indirilemedi: HTTP ${res.status}`)

  const lengthHeader = res.headers.get('content-length')
  if (lengthHeader && Number(lengthHeader) > MAX_TARBALL_BYTES) {
    throw new Error('Repo arşivi çok büyük (80 MB sınırı).')
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_TARBALL_BYTES) {
    throw new Error('Repo arşivi çok büyük (80 MB sınırı).')
  }
  return buffer
}

export async function extractTarball(buffer: Buffer, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  const extractor = tar.x({
    cwd: destination,
    strip: 1,
    filter: (entryPath: string, entry: unknown) => {
      const meta = entry as { type?: string; linkpath?: string }
      const normalized = entryPath.replace(/\\/g, '/')
      if (normalized.startsWith('/')) return false
      if (normalized.split('/').includes('..')) return false
      // Symlink/hardlink girdileri hedef dizin dışına işaret edebilir.
      if (meta.type === 'SymbolicLink' || meta.type === 'Link') return false
      if (meta.linkpath) return false
      return true
    }
  })
  await pipeline(Readable.from(buffer), extractor)
}

export async function downloadAndExtract(
  owner: string,
  repo: string,
  commit: string,
  destination: string
): Promise<void> {
  const buffer = await downloadTarball(owner, repo, commit)
  await extractTarball(buffer, destination)
}

export function repoCacheKey(owner: string, repo: string, commit: string): string {
  return `${owner}/${repo}@${commit}`
}
