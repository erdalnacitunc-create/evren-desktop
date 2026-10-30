import { BrowserWindow } from 'electron'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  InstalledExtension,
  McpElicitationRequest,
  McpElicitationResponse,
  McpPromptInfo,
  McpPromptResult,
  McpResourceContent,
  McpResourceInfo,
  McpServerConfig,
  McpServerStatus,
  McpTaskInfo,
  McpToolInfo
} from '../../shared/types'
import { listExtensions } from '../extensions/store'
import { CallbackServer, StoredOAuthProvider } from './oauthProvider'
import { clearOAuthState } from './oauthStore'
import { createLogger } from '../logger'

const log = createLogger('mcp/manager')

interface ServerResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
}

interface ServerResourceTemplate {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
}

interface ServerPrompt {
  name: string
  description?: string
  title?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

interface Connection {
  extension: InstalledExtension
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  state: McpServerStatus['state']
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
  resources: ServerResource[]
  resourceTemplates: ServerResourceTemplate[]
  prompts: ServerPrompt[]
  taskCapable: boolean
  error?: string
}

const connections = new Map<string, Connection>()

interface PendingElicitation {
  resolve: (response: McpElicitationResponse) => void
  timer: NodeJS.Timeout
}

const pendingElicitations = new Map<string, PendingElicitation>()

export function sanitizeToolName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} zaman aşımı (${ms} ms)`)), ms)
    )
  ])
}

function buildEnv(config: McpServerConfig): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return { ...env, ...(config.env ?? {}) }
}

interface CreatedTransport {
  transport: unknown
  callback?: CallbackServer
}

async function createTransport(
  config: McpServerConfig,
  extension: InstalledExtension
): Promise<CreatedTransport> {
  if (config.type === 'remote') {
    if (!config.url) throw new Error('Uzak MCP için URL gerekli.')
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )

    const callback = new CallbackServer()
    let redirectUri: string
    try {
      redirectUri = await callback.start()
    } catch (error) {
      await callback.close()
      throw error
    }

    const provider = await StoredOAuthProvider.create(extension.id, callback, redirectUri)
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
      authProvider: provider as unknown as OAuthClientProvider
    })
    return { transport, callback }
  }

  if (!config.command) throw new Error('Yerel MCP için komut gerekli.')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  return {
    transport: new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      cwd: config.cwd,
      env: buildEnv(config)
    })
  }
}

function statusOf(connection: Connection): McpServerStatus {
  return {
    id: connection.extension.id,
    name: connection.extension.name,
    state: connection.state,
    toolCount: connection.tools.length,
    resourceCount: connection.resources.length + connection.resourceTemplates.length,
    promptCount: connection.prompts.length,
    taskCapable: connection.taskCapable,
    error: connection.error
  }
}

function respondElicitation(
  id: string,
  response: McpElicitationResponse
): boolean {
  const pending = pendingElicitations.get(id)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingElicitations.delete(id)
  pending.resolve(response)
  return true
}

export function respondMcpElicitation(
  id: string,
  response: McpElicitationResponse
): boolean {
  return respondElicitation(id, response)
}

function elicitFromUser(
  extension: InstalledExtension,
  params: {
    message: string
    mode?: string
    url?: string
    requestedSchema?: Record<string, unknown>
  }
): Promise<McpElicitationResponse> {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    return Promise.resolve({ action: 'decline' })
  }

  const id = crypto.randomUUID()
  const mode = params.mode === 'url' || params.url ? 'url' : 'form'
  const request: McpElicitationRequest = {
    id,
    serverId: extension.id,
    serverName: extension.name,
    message: params.message,
    mode,
    url: params.url,
    schema: mode === 'form' ? params.requestedSchema : undefined
  }

  return new Promise<McpElicitationResponse>((resolve) => {
    const timer = setTimeout(() => {
      pendingElicitations.delete(id)
      resolve({ action: 'decline' })
    }, 5 * 60_000)
    pendingElicitations.set(id, { resolve, timer })
    for (const window of windows) {
      if (!window.isDestroyed()) window.webContents.send('mcp:elicitation', request)
    }
  })
}

async function listAll<T extends { nextCursor?: string }>(
  request: (cursor?: string) => Promise<T>,
  pick: (result: T) => unknown[],
  label: string
): Promise<unknown[]> {
  const items: unknown[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page += 1) {
    const result = await withTimeout(request(cursor), 20_000, label)
    items.push(...pick(result))
    cursor = result.nextCursor
    if (!cursor) break
  }
  return items
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachClientHandlers(client: any, extension: InstalledExtension): void {
  void import('@modelcontextprotocol/sdk/types.js').then(({ ElicitRequestSchema }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(client as any).setRequestHandler(
      ElicitRequestSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (request: any): Promise<McpElicitationResponse> => {
        const params = request?.params ?? {}
        return elicitFromUser(extension, {
          message: typeof params.message === 'string' ? params.message : 'MCP onayı',
          mode: params.mode,
          url: typeof params.url === 'string' ? params.url : undefined,
          requestedSchema:
            params.requestedSchema && typeof params.requestedSchema === 'object'
              ? (params.requestedSchema as Record<string, unknown>)
              : undefined
        })
      }
    )
  })
}

export async function connectMcp(extension: InstalledExtension): Promise<McpServerStatus> {
  if (extension.type !== 'mcp' || !extension.config) {
    throw new Error('Bu uzantı bir MCP sunucusu değil.')
  }

  const existing = connections.get(extension.id)
  if (existing?.state === 'connected') return statusOf(existing)

  const connection: Connection = {
    extension,
    client: null,
    state: 'connecting',
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    taskCapable: false
  }
  connections.set(extension.id, connection)
  let callback: CallbackServer | null = null

  try {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    const createClient = (): unknown =>
      new Client(
        { name: 'evren-desktop', version: '0.1.0' },
        {
          capabilities: {
            elicitation: { form: {}, url: {} },
            tasks: { list: {}, cancel: {} }
          }
        }
      )

    let created = await createTransport(extension.config, extension)
    callback = created.callback ?? null
    let client = createClient()
    attachClientHandlers(client, extension)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTimeout((client as any).connect(created.transport), 30_000, 'MCP bağlantısı')
    } catch (error) {
      const { UnauthorizedError } = await import('@modelcontextprotocol/sdk/client/auth.js')
      if (!callback || !(error instanceof UnauthorizedError)) throw error

      // Tarayici zaten acildi; callback kodunu bekle.
      const code = await callback.waitForCode(5 * 60_000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (created.transport as any).finishAuth(code)
      await callback.close()
      callback = null

      created = await createTransport(extension.config, extension)
      callback = created.callback ?? null
      client = createClient()
      attachClientHandlers(client, extension)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTimeout((client as any).connect(created.transport), 30_000, 'MCP bağlantısı (OAuth)')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listed = (await withTimeout((client as any).listTools(), 20_000, 'MCP araç listesi')) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
    }

    connection.client = client
    connection.state = 'connected'
    connection.tools = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
    connection.error = undefined

    const capabilities =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (typeof (client as any).getServerCapabilities === 'function'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client as any).getServerCapabilities()
        : {}) ?? {}

    if (capabilities.resources) {
      try {
        const resources = (await listAll(
          (cursor) => (client as any).listResources(cursor ? { cursor } : {}),
          (result) => (result as { resources?: unknown[] }).resources ?? [],
          'MCP kaynak listesi'
        )) as ServerResource[]
        const templates = (await listAll(
          (cursor) => (client as any).listResourceTemplates(cursor ? { cursor } : {}),
          (result) => (result as { resourceTemplates?: unknown[] }).resourceTemplates ?? [],
          'MCP kaynak şablonları'
        )) as ServerResourceTemplate[]
        connection.resources = resources
        connection.resourceTemplates = templates
      } catch (error) {
        log.warn('MCP kaynakları alınamadı:', error)
      }
    }

    if (capabilities.prompts) {
      try {
        connection.prompts = (await listAll(
          (cursor) => (client as any).listPrompts(cursor ? { cursor } : {}),
          (result) => (result as { prompts?: unknown[] }).prompts ?? [],
          'MCP prompt listesi'
        )) as ServerPrompt[]
      } catch (error) {
        log.warn('MCP promptları alınamadı:', error)
      }
    }

    connection.taskCapable = !!capabilities.tasks
    return statusOf(connection)
  } catch (error) {
    connection.state = 'error'
    connection.error = error instanceof Error ? error.message : String(error)
    connection.tools = []
    connection.resources = []
    connection.resourceTemplates = []
    connection.prompts = []
    connection.taskCapable = false
    return statusOf(connection)
  } finally {
    await callback?.close().catch(() => undefined)
  }
}

export async function disconnectMcp(id: string): Promise<void> {
  const connection = connections.get(id)
  if (!connection) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (connection.client as any)?.close?.()
  } catch {
    // yut
  }
  connections.delete(id)
}

export async function disconnectAllMcp(): Promise<void> {
  for (const id of [...connections.keys()]) {
    await disconnectMcp(id)
  }
}

export async function logoutMcp(serverId: string): Promise<void> {
  await disconnectMcp(serverId)
  await clearOAuthState(serverId)
}

export function mcpStatuses(): McpServerStatus[] {
  return [...connections.values()].map(statusOf)
}

function connectedEntries(): Connection[] {
  return [...connections.values()].filter(
    (connection) => connection.state === 'connected' && connection.client
  )
}

export async function listMcpTools(): Promise<McpToolInfo[]> {
  const items: McpToolInfo[] = []
  for (const connection of connectedEntries()) {
    for (const tool of connection.tools) {
      items.push({
        serverId: connection.extension.id,
        serverName: connection.extension.name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        taskCapable: connection.taskCapable
      })
    }
  }
  return items
}

export async function listMcpResources(): Promise<McpResourceInfo[]> {
  const items: McpResourceInfo[] = []
  for (const connection of connectedEntries()) {
    const serverId = connection.extension.id
    const serverName = connection.extension.name
    for (const resource of connection.resources) {
      items.push({
        serverId,
        serverName,
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        size: resource.size
      })
    }
    for (const template of connection.resourceTemplates) {
      items.push({
        serverId,
        serverName,
        uri: template.uriTemplate,
        name: template.name,
        description: template.description,
        mimeType: template.mimeType,
        template: true,
        uriTemplate: template.uriTemplate
      })
    }
  }
  return items
}

export async function readMcpResource(
  serverId: string,
  uri: string
): Promise<McpResourceContent[]> {
  const connection = connections.get(serverId)
  if (!connection || connection.state !== 'connected' || !connection.client) {
    throw new Error('MCP sunucusu bağlı değil.')
  }
  const result = (await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connection.client as any).readResource({ uri }),
    30_000,
    'MCP kaynak okuma'
  )) as {
    contents?: Array<{
      uri?: string
      mimeType?: string
      text?: string
      blob?: string
    }>
  }

  const limit = 200_000
  const blobLimit = 1_500_000
  return (result.contents ?? []).map((item) => {
    const text = typeof item.text === 'string' ? item.text : undefined
    const blob = typeof item.blob === 'string' ? item.blob : undefined
    return {
      uri: item.uri ?? uri,
      mimeType: item.mimeType,
      text: text && text.length > limit ? `${text.slice(0, limit)}\n… (kısaltıldı)` : text,
      blob: blob && blob.length > blobLimit ? undefined : blob,
      truncated:
        (text !== undefined && text.length > limit) ||
        (blob !== undefined && blob.length > blobLimit)
    }
  })
}

export async function listMcpPrompts(): Promise<McpPromptInfo[]> {
  const items: McpPromptInfo[] = []
  for (const connection of connectedEntries()) {
    for (const prompt of connection.prompts) {
      items.push({
        serverId: connection.extension.id,
        serverName: connection.extension.name,
        name: prompt.name,
        description: prompt.description,
        title: prompt.title,
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: argument.name,
          description: argument.description,
          required: argument.required
        }))
      })
    }
  }
  return items
}

export async function getMcpPrompt(
  serverId: string,
  name: string,
  args: Record<string, string>
): Promise<McpPromptResult> {
  const connection = connections.get(serverId)
  if (!connection || connection.state !== 'connected' || !connection.client) {
    throw new Error('MCP sunucusu bağlı değil.')
  }
  const result = (await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connection.client as any).getPrompt({ name, arguments: args }),
    30_000,
    'MCP prompt getirme'
  )) as {
    description?: string
    messages?: Array<{ role?: string; content?: unknown }>
  }

  const messages = (result.messages ?? []).map((message) => {
    const content = message.content
    let text = ''
    if (typeof content === 'string') text = content
    else if (content && typeof content === 'object') {
      const record = content as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') text = record.text
      else if (record.type === 'image') text = '[görsel]'
      else if (record.type === 'audio') text = '[ses]'
      else if (record.type === 'resource' && record.resource) {
        const resource = record.resource as Record<string, unknown>
        text =
          typeof resource.text === 'string'
            ? resource.text
            : `[kaynak: ${String(resource.uri ?? '')}]`
      } else text = JSON.stringify(content)
    }
    return { role: message.role ?? 'user', text }
  })

  return { description: result.description, messages }
}

function toTaskInfo(connection: Connection, task: Record<string, unknown>): McpTaskInfo {
  return {
    serverId: connection.extension.id,
    serverName: connection.extension.name,
    taskId: String(task.taskId ?? ''),
    status: String(task.status ?? 'working'),
    ttl: typeof task.ttl === 'number' ? task.ttl : null,
    createdAt: String(task.createdAt ?? ''),
    lastUpdatedAt: String(task.lastUpdatedAt ?? ''),
    pollInterval: typeof task.pollInterval === 'number' ? task.pollInterval : undefined,
    statusMessage: typeof task.statusMessage === 'string' ? task.statusMessage : undefined
  }
}

export async function listMcpTasks(): Promise<McpTaskInfo[]> {
  const items: McpTaskInfo[] = []
  for (const connection of connectedEntries()) {
    if (!connection.taskCapable) continue
    try {
      const result = (await withTimeout(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (connection.client as any).experimental.tasks.listTasks(),
        20_000,
        'MCP görev listesi'
      )) as { tasks?: Array<Record<string, unknown>> }
      for (const task of result.tasks ?? []) items.push(toTaskInfo(connection, task))
    } catch (error) {
      log.warn('MCP görevleri alınamadı:', error)
    }
  }
  return items
}

export async function cancelMcpTask(serverId: string, taskId: string): Promise<McpTaskInfo | null> {
  const connection = connections.get(serverId)
  if (!connection || connection.state !== 'connected' || !connection.client) {
    throw new Error('MCP sunucusu bağlı değil.')
  }
  const result = (await withTimeout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connection.client as any).experimental.tasks.cancelTask(taskId),
    20_000,
    'MCP görev iptali'
  )) as Record<string, unknown>
  return toTaskInfo(connection, result)
}

export async function getMcpTaskResult(
  serverId: string,
  taskId: string
): Promise<{ ok: boolean; content: string }> {
  const connection = connections.get(serverId)
  if (!connection || connection.state !== 'connected' || !connection.client) {
    return { ok: false, content: 'MCP sunucusu bağlı değil.' }
  }
  try {
    const { CallToolResultSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const result = (await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (connection.client as any).experimental.tasks.getTaskResult(
        taskId,
        CallToolResultSchema
      ),
      30_000,
      'MCP görev sonucu'
    )) as Record<string, unknown>
    const content = result?.content
    if (Array.isArray(content)) {
      return {
        ok: true,
        content: content
          .map((item) =>
            item && typeof item === 'object' && (item as { type?: string }).type === 'text'
              ? String((item as { text?: string }).text ?? '')
              : JSON.stringify(item)
          )
          .join('\n')
      }
    }
    return { ok: true, content: JSON.stringify(result, null, 2) }
  } catch (error) {
    return {
      ok: false,
      content: `MCP görev sonucu alınamadı: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export interface AgentMcpTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  serverId: string
  toolName: string
  serverName?: string
  taskCapable?: boolean
  meta?: 'list' | 'call' | 'describe'
}

export async function listServerTools(
  serverId: string
): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
  return connections.get(serverId)?.tools ?? []
}

export async function getAgentMcpTools(): Promise<AgentMcpTool[]> {
  const extensions = (await listExtensions()).filter(
    (extension) => extension.type === 'mcp' && extension.enabled && extension.config
  )

  const connected: Array<{
    extension: InstalledExtension
    tools: Array<{ name: string; description?: string; inputSchema: unknown }>
    taskCapable: boolean
  }> = []

  for (const extension of extensions) {
    let connection = connections.get(extension.id)
    if (!connection || connection.state !== 'connected') {
      await connectMcp(extension)
      connection = connections.get(extension.id)
    }
    if (!connection || connection.state !== 'connected') continue
    connected.push({
      extension,
      tools: connection.tools,
      taskCapable: connection.taskCapable
    })
  }

  const totalTools = connected.reduce((sum, item) => sum + item.tools.length, 0)

  // EVREN tools maxItems = 128. Cok aracli sunucularda meta-araclar kullan.
  if (totalTools <= 80) {
    const tools: AgentMcpTool[] = []
    for (const { extension, tools: serverTools, taskCapable } of connected) {
      const serverName = sanitizeToolName(extension.name)
      for (const tool of serverTools) {
        const inputSchema =
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? (tool.inputSchema as Record<string, unknown>)
            : { type: 'object', properties: {} }
        const parameters = taskCapable
          ? {
              ...inputSchema,
              properties: {
                ...((inputSchema.properties as Record<string, unknown>) ?? {}),
                task: {
                  type: 'boolean',
                  description: 'true ise araç MCP görevi olarak başlatılır.'
                }
              }
            }
          : inputSchema
        tools.push({
          name: `${serverName}_${sanitizeToolName(tool.name)}`,
          description: tool.description ?? `${extension.name} / ${tool.name}`,
          parameters,
          serverId: extension.id,
          toolName: tool.name,
          meta: undefined,
          serverName,
          taskCapable
        })
      }
    }
    return tools
  }

  const metaTools: AgentMcpTool[] = []
  for (const { extension, tools: serverTools, taskCapable } of connected) {
    const serverName = sanitizeToolName(extension.name)
    metaTools.push({
      name: `mcp_${serverName}_list_tools`,
      description:
        `${extension.name} MCP sunucusundaki ${serverTools.length} aracı listeler. ` +
        'Yalnızca ad ve kısa açıklama döner. Bir aracın tam şeması için describe_tool kullanın.',
      parameters: { type: 'object', properties: {} },
      serverId: extension.id,
      toolName: '',
      serverName,
      taskCapable,
      meta: 'list'
    })
    metaTools.push({
      name: `mcp_${serverName}_describe_tool`,
      description:
        `${extension.name} MCP sunucusundaki tek bir aracın tam giriş şemasını döndürür. ` +
        'Çağırmadan önce doğru argümanları öğrenmek için kullanın.',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Şeması istenen araç adı.' }
        },
        required: ['tool']
      },
      serverId: extension.id,
      toolName: '',
      serverName,
      taskCapable,
      meta: 'describe'
    })
    metaTools.push({
      name: `mcp_${serverName}_call`,
      description:
        `${extension.name} MCP sunucusunda bir araç çağırır. ` +
        'Önce list_tools ile araç adını, describe_tool ile argüman şemasını öğrenin.' +
        (taskCapable
          ? ' Uzun süren işlerde task=true ile MCP görevi oluşturabilirsiniz.'
          : ''),
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Çağrılacak araç adı.' },
          arguments: { type: 'object', description: 'Araç argümanları (JSON nesnesi).' },
          ...(taskCapable
            ? {
                task: {
                  type: 'boolean',
                  description: 'true ise araç MCP görevi olarak başlatılır ve taskId döner.'
                }
              }
            : {})
        },
        required: ['tool']
      },
      serverId: extension.id,
      toolName: '',
      serverName,
      taskCapable,
      meta: 'call'
    })
  }
  return metaTools
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; content: string }> {
  const connection = connections.get(serverId)
  if (!connection || connection.state !== 'connected' || !connection.client) {
    return { ok: false, content: 'MCP sunucusu bağlı değil.' }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await withTimeout(
      (connection.client as any).callTool({ name: toolName, arguments: args }),
      60_000,
      'MCP araç çağrısı'
    )) as {
      isError?: boolean
      content?: Array<{ type?: string; text?: string }>
    }

    const content = (result.content ?? [])
      .map((item) => (item?.type === 'text' ? (item.text ?? '') : JSON.stringify(item)))
      .join('\n')

    return { ok: !result.isError, content: content || 'Tamamlandı.' }
  } catch (error) {
    return {
      ok: false,
      content: `MCP hatası: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export async function callMcpToolAsTask(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  ttlMinutes = 10
): Promise<{ ok: boolean; content: string; task?: McpTaskInfo }> {
  const connection = connections.get(serverId)
  if (!connection || connection.state !== 'connected' || !connection.client) {
    return { ok: false, content: 'MCP sunucusu bağlı değil.' }
  }
  if (!connection.taskCapable) {
    return { ok: false, content: 'Bu MCP sunucusu görevleri desteklemiyor.' }
  }
  try {
    const ttl = Math.max(1, Math.min(24 * 60, ttlMinutes)) * 60_000
    const result = (await withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (connection.client as any).callTool(
        { name: toolName, arguments: args },
        undefined,
        { task: { ttl } }
      ),
      60_000,
      'MCP görev oluşturma'
    )) as Record<string, unknown>

    const task = result?.task
    if (task && typeof task === 'object') {
      const info = toTaskInfo(connection, task as Record<string, unknown>)
      return {
        ok: true,
        content: `MCP görevi oluşturuldu. taskId=${info.taskId}, durum=${info.status}`,
        task: info
      }
    }
    const content = Array.isArray(result?.content)
      ? (result.content as Array<{ type?: string; text?: string }>)
          .map((item) =>
            item?.type === 'text' ? (item.text ?? '') : JSON.stringify(item)
          )
          .join('\n')
      : ''
    return { ok: true, content: content || 'Tamamlandı.' }
  } catch (error) {
    return {
      ok: false,
      content: `MCP görev hatası: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
