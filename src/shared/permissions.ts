import type {
  AgentMode,
  AgentProfile,
  PermissionAction,
  PermissionCategory,
  PermissionRule,
  PermissionSettings
} from './types'

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  'read',
  'edit',
  'execute',
  'browser',
  'mcp',
  'computer'
]

export const PERMISSION_LABELS: Record<PermissionCategory, string> = {
  read: 'Dosya okuma',
  edit: 'Dosya düzenleme',
  execute: 'Komut çalıştırma',
  browser: 'Tarayıcı',
  mcp: 'MCP / eklenti',
  computer: 'Bilgisayar kontrolü'
}

export const PERMISSION_DESCRIPTIONS: Record<PermissionCategory, string> = {
  read: 'Dosya okuma, listeleme, arama',
  edit: 'Dosya oluşturma, düzenleme, silme',
  execute: 'Kabuk komutu çalıştırma',
  browser: 'Sayfa açma, tıklama, form doldurma',
  mcp: 'MCP sunucuları ve eklenti araçları',
  computer: 'Fare, klavye ve ekran kontrolü'
}

export function toolCategory(toolName: string): PermissionCategory {
  if (toolName.startsWith('browser_')) return 'browser'
  if (toolName.startsWith('computer_')) return 'computer'
  if (toolName === 'run_command' || toolName === 'execute') return 'execute'
  if (
    toolName === 'write_file' ||
    toolName === 'edit_file' ||
    toolName === 'patch' ||
    toolName === 'delete_file' ||
    toolName === 'create_directory'
  ) {
    return 'edit'
  }
  if (toolName.startsWith('mcp_') || toolName.startsWith('plugin_')) return 'mcp'
  return 'read'
}

export function resolvePermission(
  settings: PermissionSettings | undefined,
  mode: AgentMode,
  profile: AgentProfile,
  category: PermissionCategory,
  resource = ''
): PermissionAction {
  // Plan modu kaynak kodu ve sistemi degistiremez.
  if (profile === 'plan' && (category === 'edit' || category === 'execute' || category === 'computer')) {
    return 'deny'
  }
  if (profile === 'plan' && category === 'mcp') {
    return settings?.mcp === 'deny' ? 'deny' : 'ask'
  }
  const rule = selectPermissionRule(settings?.rules, category, resource)
  if (rule) return rule
  const explicit = settings?.[category]
  if (explicit === 'allow' || explicit === 'ask' || explicit === 'deny') return explicit
  return mode === 'auto' ? 'allow' : 'ask'
}

/**
 * Bir araç çağrısının kural eşleştirmesinde kullanılacak kaynağını döndürür.
 * Örn. `run_command` için komut, `write_file` için yol, `webfetch` için URL.
 */
export function permissionResource(
  toolName: string,
  args: Record<string, unknown> | undefined
): string {
  const a = args ?? {}
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

  switch (toolName) {
    case 'run_command':
      return text(a['command'])
    case 'run_python':
      return text(a['code']).split('\n')[0] ?? ''
    case 'execute':
      return text(a['script']).split('\n')[0] ?? ''
    case 'git':
      return `git ${text(a['action'])}`.trim()
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
    case 'create_directory':
    case 'list_files':
    case 'reference':
      return text(a['path'])
    case 'glob':
    case 'grep':
    case 'code_search':
      return text(a['pattern']) || text(a['query'])
    case 'webfetch':
    case 'browser_open':
      return text(a['url'])
    case 'websearch':
      return text(a['query'])
    default:
      break
  }

  if (toolName.startsWith('browser_')) return text(a['url']) || text(a['selector'])
  if (toolName.startsWith('mcp_') || toolName.startsWith('plugin_')) return toolName
  if (toolName.startsWith('computer_')) return toolName
  return ''
}

/** Basit joker eşleştirme: `*` her şey, `?` tek karakter. Büyük/küçük harf duyarsız. */
export function matchesPermissionPattern(pattern: string, value: string): boolean {
  const trimmed = pattern.trim()
  if (!trimmed) return false
  if (trimmed === '*') return true
  let regex = ''
  for (const char of trimmed) {
    if (char === '*') regex += '[\\s\\S]*'
    else if (char === '?') regex += '.'
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${regex}$`, 'i').test(value)
  } catch {
    return false
  }
}

/**
 * Kategori + kaynak için geçerli kuralı seçer.
 * En çok sabit karakter içeren (en özel) desen kazanır; eşitlikte son tanımlı kural kazanır.
 */
export function selectPermissionRule(
  rules: PermissionRule[] | undefined,
  category: PermissionCategory,
  resource: string
): PermissionAction | null {
  if (!rules || rules.length === 0) return null
  // Kaynağı olmayan araçlarda kural uygulanmaz; kategori varsayılanı geçerlidir.
  if (!resource) return null
  let best: PermissionRule | null = null
  let bestScore = -1
  for (const rule of rules) {
    if (rule.category !== category) continue
    if (!matchesPermissionPattern(rule.resource, resource)) continue
    const score = rule.resource.replace(/[*?]/g, '').length
    if (score >= bestScore) {
      best = rule
      bestScore = score
    }
  }
  return best ? best.effect : null
}
