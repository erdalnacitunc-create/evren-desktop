import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_BASE_URL } from './api'
import { PERMISSION_CATEGORIES } from '../shared/permissions'
import type {
  AppSettings,
  ChatDefaults,
  CompactionSettings,
  GithubAppSettings,
  HeadlessSettings,
  HookSettings,
  MemorySettings,
  PermissionCategory,
  PermissionRule,
  PermissionSettings,
  SubagentSettings,
  ThemeMode
} from '../shared/types'

let cached: AppSettings | null = null

const DEFAULT_MEMORY: MemorySettings = {
  autoMemory: true,
  extractionModel: 'session',
  retrievalTopK: 6,
  retrievalTokenBudget: 900,
  maxMemories: 2000
}

const DEFAULT_COMPACTION: CompactionSettings = {
  auto: true,
  thresholdPercent: 80,
  keepTokens: 15000,
  bufferPercent: 10
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function clampNumber(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

function normalizeChatDefaults(input: Partial<ChatDefaults>): ChatDefaults {
  const result: ChatDefaults = {}
  const temperature = clampNumber(input.temperature, 0, 2)
  if (temperature !== undefined) result.temperature = temperature
  const topP = clampNumber(input.top_p, 0, 1)
  if (topP !== undefined) result.top_p = topP
  const maxTokens = clampNumber(input.max_tokens, 1, 1_000_000)
  if (maxTokens !== undefined) result.max_tokens = Math.round(maxTokens)
  if (typeof input.reasoning_effort === 'string' && input.reasoning_effort.trim()) {
    result.reasoning_effort = input.reasoning_effort.trim().slice(0, 32)
  }
  if (typeof input.thinking === 'boolean') result.thinking = input.thinking
  return result
}

function normalize(input: Partial<AppSettings>): AppSettings {
  const baseUrl =
    typeof input.baseUrl === 'string' && input.baseUrl.trim()
      ? input.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_BASE_URL
  const result: AppSettings = {
    baseUrl,
    ...normalizeChatDefaults(input),
    memory: normalizeMemory(input.memory),
    compaction: normalizeCompaction(input.compaction),
    headless: normalizeHeadless(input.headless),
    subagents: normalizeSubagents(input.subagents),
    githubApp: normalizeGithubApp(input.githubApp)
  }
  if (input.agentMode === 'auto' || input.agentMode === 'confirm') {
    result.agentMode = input.agentMode
  }
  if (input.theme === 'dark' || input.theme === 'light' || input.theme === 'system') {
    result.theme = input.theme as ThemeMode
  }
  if (input.locale === 'tr' || input.locale === 'en') {
    result.locale = input.locale
  }
  if (typeof input.browserTools === 'boolean') result.browserTools = input.browserTools
  if (typeof input.computerTools === 'boolean') result.computerTools = input.computerTools
  if (typeof input.workspaceTools === 'boolean') result.workspaceTools = input.workspaceTools
  if (typeof input.githubOAuthClientId === 'string' && input.githubOAuthClientId.trim()) {
    result.githubOAuthClientId = input.githubOAuthClientId.trim().slice(0, 200)
  }
  if (typeof input.workspacePath === 'string' && input.workspacePath.trim()) {
    result.workspacePath = input.workspacePath.trim()
  } else if (input.workspacePath === null) {
    result.workspacePath = null
  }
  if (Array.isArray(input.references)) {
    const references = input.references
      .filter(
        (item): item is { name: string; path: string } =>
          !!item &&
          typeof item.name === 'string' &&
          typeof item.path === 'string' &&
          /^[a-zA-Z0-9_.-]{1,64}$/.test(item.name.trim()) &&
          item.path.trim().length > 0
      )
      .map((item) => ({ name: item.name.trim(), path: item.path.trim() }))
      .slice(0, 32)
    if (references.length > 0) result.references = references
  }
  const permissions = normalizePermissions(input.permissions)
  if (Object.keys(permissions).length > 0) result.permissions = permissions
  const hooks = normalizeHooks(input.hooks)
  if (hooks) result.hooks = hooks
  return result
}

function normalizeHooks(input: Partial<HookSettings> | undefined): HookSettings | undefined {
  if (!input || typeof input !== 'object') return undefined
  return {
    formatOnEdit: input.formatOnEdit === true,
    preCommitChecks: input.preCommitChecks === true
  }
}

function normalizePermissions(
  input: Partial<PermissionSettings> | undefined
): PermissionSettings {
  const result: PermissionSettings = {}
  for (const category of PERMISSION_CATEGORIES) {
    const value = input?.[category]
    if (value === 'allow' || value === 'ask' || value === 'deny') {
      result[category] = value
    }
  }
  const rules = normalizePermissionRules(input?.rules)
  if (rules.length > 0) result.rules = rules
  return result
}

const MAX_PERMISSION_RULES = 200

/** Kullanıcı tarafından düzenlenebilen izin kurallarını doğrular ve sınırlar. */
function normalizePermissionRules(input: unknown): PermissionRule[] {
  if (!Array.isArray(input)) return []
  const rules: PermissionRule[] = []
  for (const raw of input.slice(0, MAX_PERMISSION_RULES)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<PermissionRule>
    const category = item.category as PermissionCategory | undefined
    if (!category || !PERMISSION_CATEGORIES.includes(category)) continue
    if (item.effect !== 'allow' && item.effect !== 'ask' && item.effect !== 'deny') continue
    const resource = typeof item.resource === 'string' ? item.resource.trim() : ''
    if (!resource) continue
    const id =
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim().slice(0, 64)
        : `rule_${rules.length + 1}`
    const note =
      typeof item.note === 'string' && item.note.trim()
        ? item.note.trim().slice(0, 120)
        : undefined
    rules.push({
      id,
      category,
      resource: resource.slice(0, 300),
      effect: item.effect,
      ...(note ? { note } : {})
    })
  }
  return rules
}

function normalizeMemory(input: Partial<MemorySettings> | undefined): MemorySettings {
  const result: MemorySettings = { ...DEFAULT_MEMORY }
  if (typeof input?.autoMemory === 'boolean') result.autoMemory = input.autoMemory
  if (typeof input?.extractionModel === 'string' && input.extractionModel.trim()) {
    result.extractionModel = input.extractionModel.trim()
  }
  const topK = clampNumber(input?.retrievalTopK, 1, 20)
  if (topK !== undefined) result.retrievalTopK = Math.round(topK)
  const budget = clampNumber(input?.retrievalTokenBudget, 100, 4000)
  if (budget !== undefined) result.retrievalTokenBudget = Math.round(budget)
  const maxMemories = clampNumber(input?.maxMemories, 100, 10000)
  if (maxMemories !== undefined) result.maxMemories = Math.round(maxMemories)
  return result
}

function normalizeCompaction(input: Partial<CompactionSettings> | undefined): CompactionSettings {
  const result: CompactionSettings = { ...DEFAULT_COMPACTION }
  if (typeof input?.auto === 'boolean') result.auto = input.auto
  const threshold = clampNumber(input?.thresholdPercent, 50, 95)
  if (threshold !== undefined) result.thresholdPercent = Math.round(threshold)
  const keep = clampNumber(input?.keepTokens, 1000, 200000)
  if (keep !== undefined) result.keepTokens = Math.round(keep)
  const buffer = clampNumber(input?.bufferPercent, 0, 40)
  if (buffer !== undefined) result.bufferPercent = Math.round(buffer)
  return result
}

function normalizeHeadless(input: Partial<HeadlessSettings> | undefined): HeadlessSettings {
  const port = clampNumber(input?.port, 1024, 65535)
  return {
    enabled: input?.enabled === true,
    port: port === undefined ? 45871 : Math.round(port)
  }
}

function normalizeSubagents(input: Partial<SubagentSettings> | undefined): SubagentSettings {
  return { autoResume: input?.autoResume === true }
}

function normalizeGithubApp(
  input: Partial<GithubAppSettings> | undefined
): GithubAppSettings | undefined {
  if (!input || typeof input !== 'object') return undefined
  const appId = typeof input.appId === 'string' ? input.appId.trim() : ''
  if (!appId) return undefined
  const installationId =
    typeof input.installationId === 'number' && Number.isFinite(input.installationId)
      ? Math.round(input.installationId)
      : undefined
  return {
    appId: appId.slice(0, 40),
    installationId,
    accountLogin: typeof input.accountLogin === 'string' ? input.accountLogin.slice(0, 120) : undefined,
    repositorySelection:
      typeof input.repositorySelection === 'string'
        ? input.repositorySelection.slice(0, 40)
        : undefined
  }
}

export async function getSettings(): Promise<AppSettings> {
  if (cached) return cached
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8')
    cached = normalize(JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<AppSettings>)
  } catch {
    cached = normalize({ baseUrl: DEFAULT_BASE_URL })
  }
  return cached
}

async function write(next: AppSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  cached = next
}

export async function setBaseUrl(raw: string): Promise<void> {
  const baseUrl = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Geçersiz adres. http:// veya https:// ile başlamalı.')
  }
  const current = await getSettings()
  await write({ ...current, baseUrl })
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings()
  const next = normalize({ ...current, ...patch })

  if (!/^https?:\/\//i.test(next.baseUrl)) {
    throw new Error('Geçersiz adres. http:// veya https:// ile başlamalı.')
  }

  await write(next)
  return next
}
