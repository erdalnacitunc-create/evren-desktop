import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { DetectedUnit } from '../../shared/types'

export interface ScannedSkill {
  id: string
  name: string
  description?: string
  relativeDir: string
  skillFile: string
}

export function parseFrontmatter(content: string): {
  data: Record<string, string>
  body: string
} {
  if (!content.startsWith('---')) return { data: {}, body: content }
  const end = content.indexOf('\n---', 3)
  if (end < 0) return { data: {}, body: content }

  const raw = content.slice(3, end).trim()
  const data: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_/-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    data[match[1]] = value
  }
  return { data, body: content.slice(end + 4).replace(/^\r?\n/, '') }
}

export async function scanSkills(root: string): Promise<ScannedSkill[]> {
  const results: ScannedSkill[] = []
  const seen = new Set<string>()

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 7) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')
    if (hasSkillFile) {
      const relativeDir = rel || '.'
      const skillFile = relativeDir === '.' ? 'SKILL.md' : `${relativeDir}/SKILL.md`
      if (!seen.has(skillFile)) {
        seen.add(skillFile)
        const content = await fs.readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => '')
        const { data } = parseFrontmatter(content)
        const id = basename(dir) === '.' ? basename(root) : basename(dir)
        results.push({
          id,
          name: data.name || id,
          description: data.description,
          relativeDir,
          skillFile
        })
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      await walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1)
    }
  }

  await walk(root, '', 0)
  return results
}

interface PackageJson {
  name?: string
  description?: string
  version?: string
  license?: string
  bin?: string | Record<string, string>
  keywords?: string[]
  scripts?: Record<string, string>
  opencode?: unknown
  evren?: unknown
  dependencies?: Record<string, string>
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

export async function detectUnits(
  root: string,
  owner: string,
  repo: string
): Promise<{ units: DetectedUnit[]; version?: string; license?: string }> {
  const units: DetectedUnit[] = []
  const pkg = await readJson<PackageJson>(join(root, 'package.json'))

  const skills = await scanSkills(root)
  for (const skill of skills) {
    units.push({
      type: 'skill',
      id: `skill:${skill.relativeDir}`,
      name: skill.name,
      description: skill.description,
      path: skill.relativeDir,
      entry: skill.skillFile
    })
  }

  const manifest = await readJson<{
    mcpb_version?: string
    name?: string
    display_name?: string
    description?: string
    version?: string
    license?: string
    server?: { mcp_config?: { command?: string; args?: string[] } }
  }>(join(root, 'manifest.json'))

  if (manifest?.mcpb_version) {
    const command = manifest.server?.mcp_config?.command
    const args = manifest.server?.mcp_config?.args ?? []
    units.push({
      type: 'mcp',
      id: `mcp:${manifest.name ?? repo}`,
      name: manifest.display_name ?? manifest.name ?? repo,
      description: manifest.description,
      path: 'manifest.json',
      details: {
        transport: 'local',
        bundled: true,
        command,
        args,
        entryPoint: (manifest.server as { entry_point?: string } | undefined)?.entry_point
      }
    })
  }

  if (pkg) {
    const keywords = (pkg.keywords ?? []).map((keyword) => keyword.toLowerCase())
    const bin = pkg.bin
    const looksMcp =
      keywords.includes('mcp') ||
      /mcp/i.test(pkg.name ?? '') ||
      (typeof bin === 'string' ? /mcp|server/i.test(bin) : false)

    const evrenManifest = await readJson<{
      name?: string
      version?: string
      entry?: string
      permissions?: Record<string, unknown>
    }>(join(root, 'evren.extension.json'))

    const evrenConfig =
      pkg.evren && typeof pkg.evren === 'object'
        ? (pkg.evren as { entry?: string; permissions?: Record<string, unknown> })
        : undefined

    let pluginEntry = evrenManifest?.entry ?? evrenConfig?.entry
    const pluginPermissions = evrenManifest?.permissions ?? evrenConfig?.permissions

    if (!pluginEntry) {
      for (const candidate of ['index.js', 'index.mjs', 'dist/index.js', 'src/index.js']) {
        try {
          await fs.access(join(root, candidate))
          pluginEntry = candidate
          break
        } catch {
          // aday yok
        }
      }
    }

    const looksPlugin =
      !!evrenManifest ||
      !!evrenConfig ||
      keywords.includes('evren-plugin') ||
      keywords.includes('opencode-plugin') ||
      !!pkg.opencode

    if (looksMcp && pkg.name) {
      const readme = await fs.readFile(join(root, 'README.md'), 'utf8').catch(() => '')
      const scriptMentionsMcp = Object.values(pkg.scripts ?? {}).some((script) =>
        /(^|\s|["'])mcp(\s|$|["'])/i.test(script)
      )
      const readmeMentionsMcpFlag = /(^|\s)--mcp(\s|$)/.test(readme)
      const args = ['-y', pkg.name]
      if ((scriptMentionsMcp || readmeMentionsMcpFlag) && !args.includes('--mcp')) {
        args.push('--mcp')
      }

      units.push({
        type: 'mcp',
        id: `mcp:${pkg.name}`,
        name: pkg.name,
        description: pkg.description,
        path: 'package.json',
        details: {
          transport: 'local',
          command: 'npx',
          args,
          package: pkg.name
        }
      })
    }

    if (looksPlugin && pkg.name && pluginEntry) {
      units.push({
        type: 'plugin',
        id: `plugin:${pkg.name}`,
        name: evrenManifest?.name ?? pkg.name,
        description: pkg.description,
        path: 'package.json',
        details: {
          entry: pluginEntry,
          permissions: pluginPermissions ?? {}
        }
      })
    }
  }

  const mcpJson = await readJson<Record<string, unknown>>(join(root, 'mcp.json'))
  if (mcpJson && !units.some((unit) => unit.type === 'mcp')) {
    units.push({
      type: 'mcp',
      id: `mcp:${repo}`,
      name: repo,
      description: 'mcp.json yapılandırması',
      path: 'mcp.json'
    })
  }

  return {
    units,
    version: pkg?.version ?? manifest?.version,
    license: pkg?.license ?? manifest?.license
  }
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const src = join(source, entry.name)
    const dest = join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(src, dest)
    } else if (entry.isFile()) {
      await fs.copyFile(src, dest)
    }
  }
}
