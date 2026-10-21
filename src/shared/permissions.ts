import type {
  AgentMode,
  AgentProfile,
  PermissionAction,
  PermissionCategory,
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
  if (toolName === 'run_command') return 'execute'
  if (
    toolName === 'write_file' ||
    toolName === 'edit_file' ||
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
  category: PermissionCategory
): PermissionAction {
  // Plan modu kaynak kodu ve sistemi degistiremez.
  if (profile === 'plan' && (category === 'edit' || category === 'execute' || category === 'computer')) {
    return 'deny'
  }
  if (profile === 'plan' && category === 'mcp') {
    return settings?.mcp === 'deny' ? 'deny' : 'ask'
  }
  const explicit = settings?.[category]
  if (explicit === 'allow' || explicit === 'ask' || explicit === 'deny') return explicit
  return mode === 'auto' ? 'allow' : 'ask'
}
