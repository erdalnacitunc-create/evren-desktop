import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { SlashCommand } from '../shared/types'
import { loadEnabledSkills } from './extensions'
import { parseFrontmatter } from './extensions/detect'

const BUILTINS: SlashCommand[] = [
  {
    id: 'builtin:compact',
    name: 'compact',
    description: 'Oturumu özetleyerek context alanı açar.',
    category: 'Oturum',
    source: 'builtin',
    acceptsArguments: true,
    argumentHint: '[odak]'
  },
  {
    id: 'builtin:clear',
    name: 'clear',
    description: 'Yeni bir sohbet başlat (hafıza korunur).',
    category: 'Oturum',
    source: 'builtin'
  },
  {
    id: 'builtin:new',
    name: 'new',
    description: 'Yeni sohbet başlat.',
    category: 'Oturum',
    source: 'builtin'
  },
  {
    id: 'builtin:memory',
    name: 'memory',
    description: 'Hafıza yöneticisini aç.',
    category: 'Hafıza',
    source: 'builtin'
  },
  {
    id: 'builtin:remember',
    name: 'remember',
    description: 'Kalıcı bir anı kaydet.',
    category: 'Hafıza',
    source: 'builtin',
    acceptsArguments: true,
    argumentHint: '<metin>'
  },
  {
    id: 'builtin:forget',
    name: 'forget',
    description: 'Eşleşen anıları sil.',
    category: 'Hafıza',
    source: 'builtin',
    acceptsArguments: true,
    argumentHint: '<sorgu>'
  },
  {
    id: 'builtin:skills',
    name: 'skills',
    description: 'Kurulu becerileri listele.',
    category: 'Beceriler',
    source: 'builtin'
  },
  {
    id: 'builtin:skill',
    name: 'skill',
    description: 'Bir beceriyi yükle.',
    category: 'Beceriler',
    source: 'builtin',
    acceptsArguments: true,
    argumentHint: '<id>'
  },
  {
    id: 'builtin:settings',
    name: 'settings',
    description: 'Ayarları aç.',
    category: 'Ayarlar',
    source: 'builtin'
  },
  {
    id: 'builtin:help',
    name: 'help',
    description: 'Komut listesini göster.',
    category: 'Yardım',
    source: 'builtin'
  }
]

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function listCommands(): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [...BUILTINS]
  const used = new Set(commands.map((command) => command.name))

  // Kullanici komutlari: %APPDATA%/evren-desktop/commands/*.md
  const commandDir = join(app.getPath('userData'), 'commands')
  try {
    const entries = await fs.readdir(commandDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const name = slug(entry.name.replace(/\.md$/, ''))
      if (!name || used.has(name)) continue
      const content = await fs.readFile(join(commandDir, entry.name), 'utf8').catch(() => '')
      if (!content.trim()) continue
      const { data, body } = parseFrontmatter(content)
      used.add(name)
      commands.push({
        id: `custom:${name}`,
        name,
        description: data.description ?? 'Özel komut',
        category: 'Özel',
        source: 'custom',
        acceptsArguments: true,
        argumentHint: data['argument-hint'],
        template: body.trim(),
        model: data.model,
        agent: data.agent
      })
    }
  } catch {
    // komut dizini yok
  }

  // Kurulu beceriler
  const skills = await loadEnabledSkills().catch(() => [])
  for (const skill of skills) {
    const base = slug(skill.name) || 'skill'
    const name = used.has(base) ? `${base}-skill` : base
    if (used.has(name)) continue
    used.add(name)
    commands.push({
      id: `skill:${skill.id}`,
      name,
      description: skill.description ?? 'Kurulu beceri',
      category: 'Beceriler',
      source: 'skill',
      acceptsArguments: true,
      skillId: skill.id
    })
  }

  return commands
}

export async function getSkillContent(
  skillId: string
): Promise<{ id: string; name: string; content: string } | null> {
  const skills = await loadEnabledSkills().catch(() => [])
  const skill = skills.find((item) => item.id === skillId)
  if (!skill) return null
  return { id: skill.id, name: skill.name, content: skill.content }
}
