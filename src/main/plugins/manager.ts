import { app, utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import type {
  InstalledExtension,
  PluginPermissions,
  PluginStatus
} from '../../shared/types'
import { extensionsRoot, listExtensions } from '../extensions/store'

interface ToolInfo {
  name: string
  description?: string
  inputSchema: unknown
}

interface PendingCall {
  resolve: (ok: boolean, content: string) => void
  timer: NodeJS.Timeout
}

interface Connection {
  extension: InstalledExtension
  child: UtilityProcess | null
  state: PluginStatus['state']
  tools: ToolInfo[]
  error?: string
  pending: Map<string, PendingCall>
}

const connections = new Map<string, Connection>()

export function sanitizePluginName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'plugin'
}

function hostPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugin-host.cjs')
    : join(app.getAppPath(), 'resources', 'plugin-host.cjs')
}

function storageFile(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
  return join(app.getPath('userData'), 'plugin-storage', `${safe}.json`)
}

async function readStorage(id: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(storageFile(id), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writeStorage(id: string, data: Record<string, unknown>): Promise<void> {
  const target = storageFile(id)
  await fs.mkdir(join(app.getPath('userData'), 'plugin-storage'), { recursive: true })
  await fs.writeFile(target, JSON.stringify(data), 'utf8')
}

function isNetworkAllowed(hostname: string, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return false
  return allowed.some((pattern) => {
    if (pattern === '*') return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return hostname.endsWith(suffix)
    }
    return hostname === pattern
  })
}

function statusOf(connection: Connection): PluginStatus {
  return {
    id: connection.extension.id,
    name: connection.extension.name,
    state: connection.state,
    toolCount: connection.tools.length,
    error: connection.error
  }
}

export async function loadPlugin(extension: InstalledExtension): Promise<PluginStatus> {
  if (extension.type !== 'plugin') throw new Error('Bu uzantı bir eklenti değil.')

  const existing = connections.get(extension.id)
  if (existing?.state === 'loaded') return statusOf(existing)

  const connection: Connection = {
    extension,
    child: null,
    state: 'loading',
    tools: [],
    pending: new Map()
  }
  connections.set(extension.id, connection)

  const pluginPath = join(extensionsRoot(), extension.localPath)
  let child: UtilityProcess
  try {
    child = utilityProcess.fork(hostPath(), [], {
      serviceName: `evren-plugin-${sanitizePluginName(extension.name).slice(0, 40)}`
    })
  } catch (error) {
    connection.state = 'error'
    connection.error = `Eklenti süreci başlatılamadı: ${
      error instanceof Error ? error.message : String(error)
    }`
    return statusOf(connection)
  }
  connection.child = child

  return new Promise<PluginStatus>((resolve) => {
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      resolve(statusOf(connection))
    }

    const timer = setTimeout(() => {
      connection.state = 'error'
      connection.error = 'Eklenti yükleme zaman aşımı.'
      try {
        child.kill()
      } catch {
        // yut
      }
      settle()
    }, 20_000)

    child.on('message', (message: unknown) => {
      void handleMessage(connection, message as Record<string, unknown>, () => {
        clearTimeout(timer)
        settle()
      })
    })

    child.on('exit', () => {
      clearTimeout(timer)
      if (connection.state === 'loading') {
        connection.state = 'error'
        connection.error = 'Eklenti süreci başlatılamadı veya kapandı.'
      } else if (connection.state === 'loaded') {
        connection.state = 'error'
        connection.error = 'Eklenti süreci beklenmedik şekilde kapandı.'
      }
      settle()
    })

    child.on('error', (error: unknown) => {
      clearTimeout(timer)
      connection.state = 'error'
      connection.error = error instanceof Error ? error.message : String(error)
      settle()
    })

    child.postMessage({
      type: 'init',
      pluginPath,
      entry: extension.entry ?? 'index.js',
      permissions: extension.permissions ?? {}
    })
  })
}

async function handleMessage(
  connection: Connection,
  message: Record<string, unknown>,
  onReady: () => void
): Promise<void> {
  if (!message || typeof message.type !== 'string') return

  if (message.type === 'ready') {
    const tools = Array.isArray(message.tools) ? (message.tools as ToolInfo[]) : []
    connection.state = 'loaded'
    connection.tools = tools
    connection.error = undefined
    onReady()
    return
  }

  if (message.type === 'init-error' || message.type === 'host-error') {
    connection.state = 'error'
    connection.error = String(message.error ?? 'Eklenti hatası')
    onReady()
    return
  }

  if (message.type === 'log') {
    console.log(`[plugin:${connection.extension.name}] ${String(message.message ?? '')}`)
    return
  }

  if (message.type === 'call-result') {
    const id = String(message.id ?? '')
    const pending = connection.pending.get(id)
    if (!pending) return
    connection.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(message.ok === true, String(message.content ?? ''))
    return
  }

  if (message.type === 'rpc') {
    const id = String(message.id ?? '')
    const method = String(message.method ?? '')
    try {
      const result = await handleRpc(connection.extension, method, message.params)
      connection.child?.postMessage({ type: 'rpc-result', id, ok: true, result })
    } catch (error) {
      connection.child?.postMessage({
        type: 'rpc-result',
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

async function handleRpc(
  extension: InstalledExtension,
  method: string,
  params: unknown
): Promise<unknown> {
  const permissions: PluginPermissions = extension.permissions ?? {}
  const input = (params ?? {}) as Record<string, unknown>

  if (method === 'fetch') {
    const rawUrl = String(input.url ?? '')
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error('Geçersiz URL.')
    }
    if (!/^https?:$/i.test(url.protocol)) throw new Error('Yalnızca http(s) desteklenir.')
    if (!isNetworkAllowed(url.hostname, permissions.network)) {
      throw new Error(`Ağ izni yok: ${url.hostname}`)
    }

    const response = await fetch(url, (input.init as RequestInit | undefined) ?? undefined)
    const text = (await response.text()).slice(0, 2 * 1024 * 1024)
    return { status: response.status, ok: response.ok, text }
  }

  if (method === 'storage.get') {
    const key = String(input.key ?? '')
    const data = await readStorage(extension.id)
    return data[key] ?? null
  }

  if (method === 'storage.set') {
    const key = String(input.key ?? '')
    if (!key) throw new Error('storage anahtarı gerekli.')
    const data = await readStorage(extension.id)
    data[key] = input.value
    const serialized = JSON.stringify(data)
    if (serialized.length > 1024 * 1024) throw new Error('Eklenti deposu 1 MB sınırını aştı.')
    await writeStorage(extension.id, data)
    return true
  }

  throw new Error(`Bilinmeyen RPC metodu: ${method}`)
}

export async function unloadPlugin(id: string): Promise<void> {
  const connection = connections.get(id)
  if (!connection) return
  try {
    connection.child?.postMessage({ type: 'dispose' })
    connection.child?.kill()
  } catch {
    // yut
  }
  for (const pending of connection.pending.values()) {
    clearTimeout(pending.timer)
    pending.resolve(false, 'Eklenti kaldırıldı.')
  }
  connection.pending.clear()
  connections.delete(id)
}

export async function unloadAllPlugins(): Promise<void> {
  for (const id of [...connections.keys()]) {
    await unloadPlugin(id)
  }
}

export function pluginStatuses(): PluginStatus[] {
  return [...connections.values()].map(statusOf)
}

export interface AgentPluginTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  pluginId: string
  toolName: string
  pluginName?: string
  meta?: 'list' | 'describe' | 'call'
}

export async function listPluginTools(pluginId: string): Promise<ToolInfo[]> {
  return connections.get(pluginId)?.tools ?? []
}

export async function getAgentPluginTools(): Promise<AgentPluginTool[]> {
  const extensions = (await listExtensions()).filter(
    (extension) => extension.type === 'plugin' && extension.enabled
  )

  const connected: Array<{ extension: InstalledExtension; tools: ToolInfo[] }> = []
  for (const extension of extensions) {
    let connection = connections.get(extension.id)
    if (!connection || connection.state !== 'loaded') {
      await loadPlugin(extension)
      connection = connections.get(extension.id)
    }
    if (!connection || connection.state !== 'loaded') continue
    connected.push({ extension, tools: connection.tools })
  }

  const totalTools = connected.reduce((sum, item) => sum + item.tools.length, 0)

  if (totalTools <= 30) {
    const tools: AgentPluginTool[] = []
    for (const { extension, tools: pluginTools } of connected) {
      const prefix = sanitizePluginName(extension.name)
      for (const tool of pluginTools) {
        tools.push({
          name: `plugin_${prefix}_${sanitizePluginName(tool.name)}`,
          description: tool.description ?? `${extension.name} / ${tool.name}`,
          parameters:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
          pluginId: extension.id,
          toolName: tool.name
        })
      }
    }
    return tools
  }

  const metaTools: AgentPluginTool[] = []
  for (const { extension, tools: pluginTools } of connected) {
    const prefix = sanitizePluginName(extension.name)
    metaTools.push(
      {
        name: `plugin_${prefix}_list_tools`,
        description: `${extension.name} eklentisindeki ${pluginTools.length} aracı listeler.`,
        parameters: { type: 'object', properties: {} },
        pluginId: extension.id,
        toolName: '',
        pluginName: extension.name,
        meta: 'list'
      },
      {
        name: `plugin_${prefix}_describe_tool`,
        description: `${extension.name} eklentisindeki tek bir aracın şemasını döndürür.`,
        parameters: {
          type: 'object',
          properties: { tool: { type: 'string' } },
          required: ['tool']
        },
        pluginId: extension.id,
        toolName: '',
        pluginName: extension.name,
        meta: 'describe'
      },
      {
        name: `plugin_${prefix}_call`,
        description: `${extension.name} eklentisinde bir araç çağırır.`,
        parameters: {
          type: 'object',
          properties: {
            tool: { type: 'string' },
            arguments: { type: 'object' }
          },
          required: ['tool']
        },
        pluginId: extension.id,
        toolName: '',
        pluginName: extension.name,
        meta: 'call'
      }
    )
  }
  return metaTools
}

export async function callPluginTool(
  pluginId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; content: string }> {
  const connection = connections.get(pluginId)
  if (!connection || connection.state !== 'loaded' || !connection.child) {
    return { ok: false, content: 'Eklenti yüklü değil.' }
  }

  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      connection.pending.delete(id)
      resolve({ ok: false, content: 'Eklenti çağrısı zaman aşımı.' })
    }, 60_000)

    connection.pending.set(id, {
      resolve: (ok, content) => resolve({ ok, content }),
      timer
    })

    connection.child?.postMessage({ type: 'call', id, tool: toolName, args })
  })
}
