import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type {
  ExtensionSource,
  InstalledExtension,
  McpServerConfig,
  PluginPermissions,
  RepoInspection
} from '../../shared/types'
import { copyDirectory, detectUnits, parseFrontmatter } from './detect'
import {
  downloadAndExtract,
  fetchRepoMetadata,
  parseGitHubUrl,
  repoCacheKey,
  resolveCommit,
  type ParsedRepo
} from './github'
import {
  extensionsRoot,
  listExtensions,
  removeExtension,
  setExtensionEnabled,
  upsertExtension
} from './store'

interface CacheEntry {
  dir: string
  inspection: RepoInspection
  expires: number
}

const inspectCache = new Map<string, CacheEntry>()

function sanitize(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'item'
}

function sourceOf(
  parsed: ParsedRepo,
  inspection: RepoInspection,
  path: string
): ExtensionSource {
  return {
    provider: 'github',
    repo: `${parsed.owner}/${parsed.repo}`,
    url: inspection.url,
    ref: parsed.ref ?? inspection.defaultBranch,
    commit: inspection.commit,
    path
  }
}

function ensureInside(root: string, relative: string): string {
  const target = relative ? join(root, relative) : root
  const normalized = target.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}/`)) {
    throw new Error('Geçersiz uzantı yolu.')
  }
  return target
}

export async function inspectRepository(
  input: string,
  token?: string
): Promise<RepoInspection> {
  const parsed = parseGitHubUrl(input)
  if (!parsed) {
    throw new Error('Geçersiz GitHub adresi. Örnek: https://github.com/owner/repo')
  }

  const metadata = await fetchRepoMetadata(parsed.owner, parsed.repo, token)
  const ref = parsed.ref ?? metadata.defaultBranch
  const commit = await resolveCommit(parsed.owner, parsed.repo, ref, token)
  const key = repoCacheKey(parsed.owner, parsed.repo, commit)
  const now = Date.now()

  const cached = inspectCache.get(key)
  if (cached && cached.expires > now) return cached.inspection
  if (cached) {
    await fs.rm(cached.dir, { recursive: true, force: true }).catch(() => {})
    inspectCache.delete(key)
  }

  const dir = join(
    app.getPath('temp'),
    `evren-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  await downloadAndExtract(parsed.owner, parsed.repo, commit, dir)
  const detected = await detectUnits(dir, parsed.owner, parsed.repo)

  const inspection: RepoInspection = {
    repo: metadata.fullName,
    url: metadata.htmlUrl,
    description: metadata.description,
    stars: metadata.stars,
    license: metadata.license ?? detected.license,
    version: detected.version,
    defaultBranch: metadata.defaultBranch,
    commit,
    units: detected.units
  }

  inspectCache.set(key, { dir, inspection, expires: now + 10 * 60 * 1000 })
  return inspection
}

export interface InstallOverride {
  command?: string
  args?: string[]
}

export async function installFromGithub(
  input: string,
  unitIds: string[],
  token?: string,
  overrides?: Record<string, InstallOverride>
): Promise<InstalledExtension[]> {
  const inspection = await inspectRepository(input, token)
  const parsed = parseGitHubUrl(input)
  if (!parsed) throw new Error('Geçersiz GitHub adresi.')

  const key = repoCacheKey(parsed.owner, parsed.repo, inspection.commit)
  const entry = inspectCache.get(key)
  if (!entry) {
    throw new Error('İnceleme önbelleği bulunamadı. Lütfen repoyu yeniden inceleyin.')
  }

  const selected = inspection.units.filter((unit) => unitIds.includes(unit.id))
  if (selected.length === 0) throw new Error('Kurulacak birim seçilmedi.')

  const installed: InstalledExtension[] = []
  const now = Date.now()

  for (const unit of selected) {
    if (unit.type === 'skill') {
      const sourceDir = ensureInside(entry.dir, unit.path === '.' ? '' : unit.path)
      const skillName = sanitize(unit.id.replace(/^skill:/, ''))
      const relativePath = join(
        'skills',
        `${sanitize(parsed.owner)}-${sanitize(parsed.repo)}`,
        skillName
      ).replace(/\\/g, '/')
      const destination = join(extensionsRoot(), relativePath)

      await fs.rm(destination, { recursive: true, force: true })
      await copyDirectory(sourceDir, destination)

      const extension: InstalledExtension = {
        id: `skill:${parsed.owner}/${parsed.repo}:${unit.id}`,
        type: 'skill',
        name: unit.name,
        description: unit.description,
        version: inspection.version,
        license: inspection.license,
        enabled: true,
        scope: 'global',
        source: sourceOf(parsed, inspection, unit.path),
        localPath: relativePath,
        installedAt: now,
        updatedAt: now
      }

      await upsertExtension(extension)
      installed.push(extension)
      continue
    }

    if (unit.type === 'mcp') {
      const details = (unit.details ?? {}) as {
        transport?: 'local' | 'remote'
        command?: string
        args?: string[]
        url?: string
        headers?: Record<string, string>
        bundled?: boolean
        entryPoint?: string
      }

      const config: McpServerConfig =
        details.transport === 'remote'
          ? { type: 'remote', url: details.url, headers: details.headers }
          : { type: 'local', command: details.command, args: details.args }

      let relativePath = ''
      if (details.bundled) {
        relativePath = join(
          'mcp',
          `${sanitize(parsed.owner)}-${sanitize(parsed.repo)}`
        ).replace(/\\/g, '/')
        const destination = join(extensionsRoot(), relativePath)
        await fs.rm(destination, { recursive: true, force: true })
        await copyDirectory(entry.dir, destination)

        const args = (details.args ?? []).map((arg) =>
          arg.replace(/\$\{__dirname\}/g, destination)
        )

        if (details.entryPoint && /^node(\.exe)?$/i.test(details.command ?? 'node')) {
          config.type = 'local'
          config.command = process.execPath
          config.args = [join(destination, details.entryPoint)]
          config.cwd = destination
          config.env = { ...(config.env ?? {}), ELECTRON_RUN_AS_NODE: '1' }
        } else if (details.command) {
          config.command = details.command
          config.args = args
          config.cwd = destination
        }
      }

      if (!config.command && !config.url) {
        throw new Error('MCP yapılandırması çözümlenemedi (komut veya URL yok).')
      }

      const override = overrides?.[unit.id]
      if (override?.command) {
        config.type = 'local'
        config.command = override.command
        config.args = override.args ?? []
      }

      const extension: InstalledExtension = {
        id: `mcp:${parsed.owner}/${parsed.repo}:${unit.id}`,
        type: 'mcp',
        name: unit.name,
        description: unit.description,
        version: inspection.version,
        license: inspection.license,
        enabled: true,
        scope: 'global',
        source: sourceOf(parsed, inspection, unit.path),
        localPath: relativePath,
        installedAt: now,
        updatedAt: now,
        config
      }

      await upsertExtension(extension)
      installed.push(extension)
      continue
    }

    if (unit.type === 'plugin') {
      const details = (unit.details ?? {}) as {
        entry?: string
        permissions?: Record<string, unknown>
      }
      const relativePath = join(
        'plugins',
        `${sanitize(parsed.owner)}-${sanitize(parsed.repo)}`
      ).replace(/\\/g, '/')
      const destination = join(extensionsRoot(), relativePath)

      await fs.rm(destination, { recursive: true, force: true })
      await copyDirectory(entry.dir, destination)

      const extension: InstalledExtension = {
        id: `plugin:${parsed.owner}/${parsed.repo}:${unit.id}`,
        type: 'plugin',
        name: unit.name,
        description: unit.description,
        version: inspection.version,
        license: inspection.license,
        enabled: true,
        scope: 'global',
        source: sourceOf(parsed, inspection, unit.path),
        localPath: relativePath,
        installedAt: now,
        updatedAt: now,
        entry: details.entry ?? 'index.js',
        permissions: (details.permissions ?? {}) as PluginPermissions
      }

      await upsertExtension(extension)
      installed.push(extension)
      continue
    }

    throw new Error('Desteklenmeyen uzantı türü.')
  }

  return installed
}

export interface LoadedSkill {
  id: string
  name: string
  description?: string
  content: string
  baseDir: string
}

export async function loadEnabledSkills(): Promise<LoadedSkill[]> {
  const extensions = await listExtensions()
  const skills: LoadedSkill[] = []

  for (const extension of extensions) {
    if (extension.type !== 'skill' || !extension.enabled) continue
    const dir = join(extensionsRoot(), extension.localPath)
    try {
      const content = await fs.readFile(join(dir, 'SKILL.md'), 'utf8')
      const { data } = parseFrontmatter(content)
      skills.push({
        id: extension.id,
        name: data.name || extension.name,
        description: data.description || extension.description,
        content,
        baseDir: dir
      })
    } catch {
      // eksik dosya: sessizce atla
    }
  }

  return skills
}

export async function removeInstalledExtension(id: string): Promise<boolean> {
  return removeExtension(id)
}

export async function setInstalledExtensionEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  return setExtensionEnabled(id, enabled)
}

export async function cleanupInspectCache(): Promise<void> {
  for (const entry of inspectCache.values()) {
    await fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {})
  }
  inspectCache.clear()
}
