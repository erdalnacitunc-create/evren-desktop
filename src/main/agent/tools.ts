import { randomUUID } from 'crypto'
import { toolCategory } from '../../shared/permissions'
import type { ChatEvent, PermissionCategory, TodoItem } from '../../shared/types'
import { callMcpTool, listServerTools, type AgentMcpTool } from '../mcp/manager'
import {
  callMcpToolAsTask,
  cancelMcpTask,
  getMcpTaskResult,
  listMcpResources,
  listMcpTasks,
  readMcpResource
} from '../mcp/manager'
import { callPluginTool, listPluginTools, type AgentPluginTool } from '../plugins/manager'
import { BrowserSession } from './browser'
import { waitForQuestion } from './question'
import { captureScreen, runComputerCommand, toSendKeys } from './computer'
import {
  deleteWorkspaceFile,
  editWorkspaceFile,
  getWorkspaceTree,
  globWorkspace,
  grepWorkspace,
  makeWorkspaceDirectory,
  readWorkspaceFile,
  runWorkspaceCommand,
  writeWorkspaceFile
} from '../workspace'
import { detectProjectChecks, runProjectChecks, formatWorkspaceFile } from '../checks'
import { buildRepoMap } from '../repoMap'
import { searchCodeIndex } from '../codeIndex'
import { getSettings } from '../settings'
import {
  addGitWorktree,
  commitGit,
  createGitPr,
  getGitDiff,
  getGitPrStatus,
  getGitStatus,
  listGitBranches,
  listGitRemotes,
  listGitWorktrees,
  pushGit,
  removeGitWorktree,
  stageGitPaths,
  unstageGitPaths
} from '../git'
import type { WorkspaceEntry } from '../../shared/types'

export interface ToolContext {
  requestId: string
  checkpointId?: string
  signal?: AbortSignal
  send: (event: ChatEvent) => void
}

export interface ToolExecutionResult {
  ok: boolean
  content: string
  imageDataUrl?: string
  checkpointId?: string
  todos?: TodoItem[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  category?: PermissionCategory
  summary: (args: Record<string, unknown>) => string
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecutionResult>
}

export interface ToolRegistry {
  definitions: () => unknown[]
  get: (name: string) => ToolDefinition | undefined
  dispose: () => Promise<void>
}

export interface SkillToolSource {
  id: string
  name: string
  description?: string
  content: string
  baseDir: string
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = NaN): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = num(args[key])
  if (!Number.isFinite(value)) throw new Error(`"${key}" sayısal olmalı.`)
  return Math.round(value)
}

function formatTree(entries: WorkspaceEntry[], depth = 0): string {
  const lines: string[] = []
  for (const entry of entries) {
    const icon = entry.type === 'dir' ? '📁' : '📄'
    const size = entry.type === 'file' && typeof entry.size === 'number' ? ` (${entry.size} b)` : ''
    lines.push(`${'  '.repeat(depth)}${icon} ${entry.name}${size}`)
    if (entry.children && entry.children.length > 0) {
      const child = formatTree(entry.children, depth + 1)
      if (child) lines.push(child)
    }
  }
  return lines.join('\n')
}

function findTreeEntry(entries: WorkspaceEntry[], target: string): WorkspaceEntry | null {
  for (const entry of entries) {
    if (entry.path === target || entry.name === target) return entry
    if (entry.children) {
      const found = findTreeEntry(entry.children, target)
      if (found) return found
    }
  }
  return null
}

async function applyFormatHook(path: string): Promise<string> {
  const settings = await getSettings()
  if (!settings.hooks?.formatOnEdit) return ''
  const result = await formatWorkspaceFile(path)
  if (!result) return '\n\nFormat hook: projede Prettier bulunamadı.'
  return `\n\nFormat hook: ${result.ok ? 'uygulandı' : 'hata'}\n${result.output}`.slice(0, 6000)
}

export function createTools(options: {
  browser: boolean
  computer: boolean
  skills?: SkillToolSource[]
  mcpTools?: AgentMcpTool[]
  pluginTools?: AgentPluginTool[]
  workspace?: { root: string; sessionId?: string }
  readOnly?: boolean
  subagentTasks?: {
    spawn: (
      agentType: 'explore' | 'review' | 'general',
      prompt: string,
      background: boolean
    ) => Promise<ToolExecutionResult>
    status: (taskId: string) => Promise<ToolExecutionResult>
    wait: (taskId: string, timeoutMs: number) => Promise<ToolExecutionResult>
    cancel: (taskId: string) => Promise<ToolExecutionResult>
    list: () => Promise<ToolExecutionResult>
  }
}): ToolRegistry {
  const tools: ToolDefinition[] = []
  const browser = options.browser ? new BrowserSession() : null
  const workspaceRoot = options.workspace?.root ?? null
  const sessionId = options.workspace?.sessionId

  for (const pluginTool of options.pluginTools ?? []) {
    if (pluginTool.meta === 'list') {
      tools.push({
        name: pluginTool.name,
        category: 'mcp',
        description: pluginTool.description,
        parameters: pluginTool.parameters,
        summary: () => `${pluginTool.pluginName ?? 'Eklenti'} araçlarını listele`,
        execute: async () => {
          const list = await listPluginTools(pluginTool.pluginId)
          return {
            ok: true,
            content: JSON.stringify(
              list.map((tool) => ({
                name: tool.name,
                description: tool.description ? tool.description.slice(0, 200) : undefined
              })),
              null,
              2
            )
          }
        }
      })
      continue
    }

    if (pluginTool.meta === 'describe') {
      tools.push({
        name: pluginTool.name,
        category: 'mcp',
        description: pluginTool.description,
        parameters: pluginTool.parameters,
        summary: (args) => `Eklenti şeması: ${str(args.tool)}`,
        execute: async (args) => {
          const toolName = str(args.tool)
          const list = await listPluginTools(pluginTool.pluginId)
          const tool = list.find((item) => item.name === toolName)
          if (!tool) return { ok: false, content: `Araç bulunamadı: ${toolName}` }
          return {
            ok: true,
            content: JSON.stringify(
              { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
              null,
              2
            )
          }
        }
      })
      continue
    }

    if (pluginTool.meta === 'call') {
      tools.push({
        name: pluginTool.name,
        category: 'mcp',
        description: pluginTool.description,
        parameters: pluginTool.parameters,
        summary: (args) => `Eklenti çağrısı: ${str(args.tool)}`,
        execute: async (args) => {
          const toolName = str(args.tool)
          if (!toolName) throw new Error('"tool" alanı gerekli.')
          const toolArgs =
            args.arguments && typeof args.arguments === 'object'
              ? (args.arguments as Record<string, unknown>)
              : {}
          const result = await callPluginTool(pluginTool.pluginId, toolName, toolArgs)
          return { ok: result.ok, content: result.content }
        }
      })
      continue
    }

    tools.push({
      name: pluginTool.name,
      category: 'mcp',
      description: pluginTool.description,
      parameters: pluginTool.parameters,
      summary: (args) => `Eklenti: ${pluginTool.name} ${JSON.stringify(args).slice(0, 120)}`,
      execute: async (args) => {
        const result = await callPluginTool(pluginTool.pluginId, pluginTool.toolName, args)
        return { ok: result.ok, content: result.content }
      }
    })
  }

  for (const mcpTool of options.mcpTools ?? []) {
    if (mcpTool.meta === 'list') {
      tools.push({
        name: mcpTool.name,
        category: 'mcp',
        description: mcpTool.description,
        parameters: mcpTool.parameters,
        summary: () => `${mcpTool.serverName ?? 'MCP'} araçlarını listele`,
        execute: async () => {
          const list = await listServerTools(mcpTool.serverId)
          return {
            ok: true,
            content: JSON.stringify(
              list.map((tool) => ({
                name: tool.name,
                description: tool.description ? tool.description.slice(0, 200) : undefined
              })),
              null,
              2
            )
          }
        }
      })
      continue
    }

    if (mcpTool.meta === 'describe') {
      tools.push({
        name: mcpTool.name,
        category: 'mcp',
        description: mcpTool.description,
        parameters: mcpTool.parameters,
        summary: (args) => `MCP şeması: ${str(args.tool)}`,
        execute: async (args) => {
          const toolName = str(args.tool)
          if (!toolName) throw new Error('"tool" alanı gerekli.')
          const list = await listServerTools(mcpTool.serverId)
          const tool = list.find((item) => item.name === toolName)
          if (!tool) {
            return { ok: false, content: `Araç bulunamadı: ${toolName}` }
          }
          return {
            ok: true,
            content: JSON.stringify(
              { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
              null,
              2
            )
          }
        }
      })
      continue
    }

    if (mcpTool.meta === 'call') {
      tools.push({
        name: mcpTool.name,
        category: 'mcp',
        description: mcpTool.description,
        parameters: mcpTool.parameters,
        summary: (args) => `MCP çağrısı: ${str(args.tool)}`,
        execute: async (args) => {
          const toolName = str(args.tool)
          if (!toolName) throw new Error('"tool" alanı gerekli.')
          const toolArgs =
            args.arguments && typeof args.arguments === 'object'
              ? (args.arguments as Record<string, unknown>)
              : {}
          const result =
            args.task === true
              ? await callMcpToolAsTask(mcpTool.serverId, toolName, toolArgs)
              : await callMcpTool(mcpTool.serverId, toolName, toolArgs)
          return { ok: result.ok, content: result.content }
        }
      })
      continue
    }

    tools.push({
      name: mcpTool.name,
      category: 'mcp',
      description: mcpTool.description,
      parameters: mcpTool.parameters,
      summary: (args) => `MCP: ${mcpTool.name} ${JSON.stringify(args).slice(0, 120)}`,
      execute: async (args) => {
        const { task: taskMode, ...toolArgs } = args
        const result =
          taskMode === true && mcpTool.taskCapable
            ? await callMcpToolAsTask(mcpTool.serverId, mcpTool.toolName, toolArgs)
            : await callMcpTool(mcpTool.serverId, mcpTool.toolName, toolArgs)
        return { ok: result.ok, content: result.content }
      }
    })
  }

  if ((options.mcpTools?.length ?? 0) > 0) {
    tools.push({
      name: 'mcp_list_resources',
      category: 'mcp',
      description:
        'Bağlı MCP sunucularındaki kaynakları ve kaynak şablonlarını listeler. ' +
        'Bir kaynağı okumak için mcp_read_resource kullanın.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'İsteğe bağlı sunucu adı veya id.' }
        }
      },
      summary: (args) => `MCP kaynakları${args.server ? `: ${str(args.server)}` : ''}`,
      execute: async (args) => {
        const server = str(args.server).toLowerCase()
        const resources = (await listMcpResources()).filter(
          (item) =>
            !server ||
            item.serverName.toLowerCase().includes(server) ||
            item.serverId.toLowerCase() === server
        )
        return {
          ok: true,
          content: JSON.stringify(
            resources.map((item) => ({
              server: item.serverName,
              uri: item.uri,
              name: item.name,
              description: item.description,
              mimeType: item.mimeType,
              template: item.template
            })),
            null,
            2
          )
        }
      }
    })

    tools.push({
      name: 'mcp_read_resource',
      category: 'mcp',
      description:
        'Bir MCP kaynağını okur. Metin içerik döner; büyük içerikler kısaltılabilir. ' +
        'Kaynak listesini mcp_list_resources ile alın.',
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Kaynak URI değeri.' },
          server: {
            type: 'string',
            description: 'İsteğe bağlı sunucu adı veya id (aynı URI birden fazla sunucuda varsa).'
          }
        },
        required: ['uri']
      },
      summary: (args) => `MCP kaynağı: ${str(args.uri)}`,
      execute: async (args) => {
        const uri = str(args.uri)
        if (!uri) throw new Error('"uri" alanı gerekli.')
        const server = str(args.server).toLowerCase()
        const resources = (await listMcpResources()).filter((item) => item.uri === uri)
        const match =
          resources.find(
            (item) =>
              !server ||
              item.serverName.toLowerCase().includes(server) ||
              item.serverId.toLowerCase() === server
          ) ?? resources[0]
        if (!match) return { ok: false, content: `Kaynak bulunamadı: ${uri}` }
        const contents = await readMcpResource(match.serverId, uri)
        return {
          ok: true,
          content:
            contents
              .map((item) =>
                item.text ?? `[binary ${item.mimeType ?? 'kaynak'}${item.truncated ? ', kısaltıldı' : ''}]`
              )
              .join('\n') || 'Kaynak boş.'
        }
      }
    })

    tools.push({
      name: 'mcp_task_list',
      category: 'mcp',
      description: 'Bağlı MCP sunucularındaki görevleri ve durumlarını listeler.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'İsteğe bağlı sunucu adı veya id.' }
        }
      },
      summary: (args) => `MCP görevleri${args.server ? `: ${str(args.server)}` : ''}`,
      execute: async (args) => {
        const server = str(args.server).toLowerCase()
        const tasks = (await listMcpTasks()).filter(
          (item) =>
            !server ||
            item.serverName.toLowerCase().includes(server) ||
            item.serverId.toLowerCase() === server
        )
        return { ok: true, content: JSON.stringify(tasks, null, 2) }
      }
    })

    tools.push({
      name: 'mcp_task_result',
      category: 'mcp',
      description: 'Tamamlanan bir MCP görevinin sonucunu getirir.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Görevin sunucu adı veya id.' },
          taskId: { type: 'string', description: 'MCP görev kimliği.' }
        },
        required: ['server', 'taskId']
      },
      summary: (args) => `MCP görev sonucu: ${str(args.taskId)}`,
      execute: async (args) => {
        const server = str(args.server).toLowerCase()
        const taskId = str(args.taskId)
        const tasks = await listMcpTasks()
        const match = tasks.find(
          (item) =>
            item.taskId === taskId &&
            (item.serverName.toLowerCase().includes(server) ||
              item.serverId.toLowerCase() === server)
        )
        if (!match) return { ok: false, content: `MCP görevi bulunamadı: ${taskId}` }
        const result = await getMcpTaskResult(match.serverId, taskId)
        return { ok: result.ok, content: result.content }
      }
    })

    tools.push({
      name: 'mcp_task_cancel',
      category: 'mcp',
      description: 'Çalışan bir MCP görevini iptal eder.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Görevin sunucu adı veya id.' },
          taskId: { type: 'string', description: 'MCP görev kimliği.' }
        },
        required: ['server', 'taskId']
      },
      summary: (args) => `MCP görev iptali: ${str(args.taskId)}`,
      execute: async (args) => {
        const server = str(args.server).toLowerCase()
        const taskId = str(args.taskId)
        const tasks = await listMcpTasks()
        const match = tasks.find(
          (item) =>
            item.taskId === taskId &&
            (item.serverName.toLowerCase().includes(server) ||
              item.serverId.toLowerCase() === server)
        )
        if (!match) return { ok: false, content: `MCP görevi bulunamadı: ${taskId}` }
        const task = await cancelMcpTask(match.serverId, taskId)
        return { ok: true, content: JSON.stringify(task, null, 2) }
      }
    })
  }

  if (options.skills && options.skills.length > 0) {
    const skills = options.skills
    tools.push({
      name: 'skill',
      category: 'read',
      description:
        'Kurulu bir becerinin talimatlarını yükler. Kullanılabilir beceriler: ' +
        skills.map((skill) => `${skill.name} [${skill.id}]`).join(', '),
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Yüklenecek becerinin kimliği.',
            enum: skills.map((skill) => skill.id)
          }
        },
        required: ['id']
      },
      summary: (args) => `Beceri yükle: ${str(args.id)}`,
      execute: async (args) => {
        const skill = skills.find((item) => item.id === str(args.id))
        if (!skill) throw new Error(`Beceri bulunamadı: ${str(args.id)}`)
        return {
          ok: true,
          content: `${skill.content}\n\n---\nTemel dizin: ${skill.baseDir}`
        }
      }
    })
  }

  tools.push({
    name: 'todo_write',
    category: 'read',
    description:
      'Görev listesini oluşturur veya günceller. Çok adımlı işlerde planı takip etmek için kullan. ' +
      'Her çağrıda listenin tamamını gönder; durumlar: pending, in_progress, completed.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Görev metni.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Görev durumu.'
              }
            },
            required: ['content', 'status']
          }
        }
      },
      required: ['todos']
    },
    summary: (args) => {
      const list = Array.isArray(args.todos) ? args.todos : []
      return `Görev listesi: ${list.length} madde`
    },
    execute: async (args) => {
      const raw = Array.isArray(args.todos) ? args.todos : []
      const todos: TodoItem[] = []
      raw.forEach((item, index) => {
        if (!item || typeof item !== 'object') return
        const record = item as Record<string, unknown>
        const content = str(record.content).trim()
        if (!content) return
        const status =
          record.status === 'in_progress' || record.status === 'completed'
            ? record.status
            : 'pending'
        todos.push({
          id: `todo-${index + 1}`,
          content: content.slice(0, 300),
          status
        })
      })
      const done = todos.filter((todo) => todo.status === 'completed').length
      return {
        ok: true,
        content: `Görev listesi güncellendi (${done}/${todos.length} tamamlandı).`,
        todos
      }
    }
  })

  if (options.subagentTasks) {
    const tasks = options.subagentTasks
    tools.push({
      name: 'spawn_agent',
      category: 'read',
      description:
        'Ayrı bağlamda çalışan bir alt ajan başlatır. agent: explore (salt-okunur keşif), ' +
        'review (salt-okunur kod incelemesi), general (çalışma alanı araçlarıyla görev). ' +
        'background=true ise hemen görev kimliği döner; sonucu task_wait/task_status ile al. ' +
        'Alt ajan yalnızca kısa bir sonuç döndürür.',
      parameters: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: ['explore', 'review', 'general'],
            description: 'Alt ajan türü.'
          },
          prompt: {
            type: 'string',
            description: 'Alt ajana verilecek açık görev ve beklenen çıktı.'
          },
          background: {
            type: 'boolean',
            description: 'true ise görev arka planda çalışır ve hemen task_id döner.'
          }
        },
        required: ['agent', 'prompt']
      },
      summary: (args) =>
        `Alt ajan · ${str(args.agent, 'explore')}${args.background === true ? ' (arka plan)' : ''}: ${str(
          args.prompt
        ).slice(0, 80)}`,
      execute: async (args) => {
        const agent = str(args.agent, 'explore')
        const type = agent === 'review' || agent === 'general' ? agent : 'explore'
        const prompt = str(args.prompt).trim()
        if (!prompt) throw new Error('Alt ajan görevi boş olamaz.')
        return tasks.spawn(type, prompt, args.background === true)
      }
    })

    tools.push({
      name: 'task_status',
      category: 'read',
      description: 'Arka plan alt-ajan görevinin durumunu ve varsa sonucunu döndürür.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'spawn_agent tarafından dönen görev kimliği.' }
        },
        required: ['task_id']
      },
      summary: (args) => `Görev durumu: ${str(args.task_id)}`,
      execute: async (args) => tasks.status(str(args.task_id))
    })

    tools.push({
      name: 'task_wait',
      category: 'read',
      description:
        'Arka plan görevinin bitmesini bekler ve sonucu döndürür. timeout_ms kadar bekler; ' +
        'süre dolarsa görev hâlâ çalışıyor olabilir.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Görev kimliği.' },
          timeout_ms: { type: 'number', description: 'Bekleme süresi (varsayılan 90000).' }
        },
        required: ['task_id']
      },
      summary: (args) => `Görev bekle: ${str(args.task_id)}`,
      execute: async (args) =>
        tasks.wait(str(args.task_id), Math.max(1000, Math.round(num(args.timeout_ms, 90_000))))
    })

    tools.push({
      name: 'task_cancel',
      category: 'read',
      description: 'Çalışan bir arka plan görevini iptal eder.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Görev kimliği.' }
        },
        required: ['task_id']
      },
      summary: (args) => `Görevi iptal et: ${str(args.task_id)}`,
      execute: async (args) => tasks.cancel(str(args.task_id))
    })

    tools.push({
      name: 'task_list',
      category: 'read',
      description: 'Bu oturumdaki arka plan alt-ajan görevlerini listeler.',
      parameters: { type: 'object', properties: {} },
      summary: () => 'Arka plan görevlerini listele',
      execute: async () => tasks.list()
    })
  }

  if (workspaceRoot) {
    const root = workspaceRoot

    tools.push({
      name: 'read_file',
      description:
        'Çalışma alanındaki bir metin dosyasını satır numaralarıyla okur. ' +
        'Düzenlemeden önce mutlaka oku. offset 1 tabanlı satırdır; limit satır sayısıdır.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Çalışma alanına göreli dosya yolu.' },
          offset: { type: 'number', description: 'Başlangıç satırı (1 tabanlı).' },
          limit: { type: 'number', description: 'Okunacak en fazla satır (varsayılan 800).' }
        },
        required: ['path']
      },
      summary: (args) => `Dosya oku: ${str(args.path)}`,
      execute: async (args) => {
        const offset = Math.max(1, Math.round(num(args.offset, 1)))
        const limit = Math.max(1, Math.min(4000, Math.round(num(args.limit, 800))))
        const file = await readWorkspaceFile(str(args.path), offset, limit)
        if (file.binary) {
          return { ok: true, content: `${file.path}: ${file.content} (${file.size} bayt)` }
        }
        const numbered = file.content
          .split('\n')
          .map((line, index) => `${offset + index}: ${line}`)
          .join('\n')
        return {
          ok: true,
          content:
            `${file.path} (${file.size} bayt${file.truncated ? ', kısaltıldı' : ''})` +
            `${file.content ? `\n${numbered}` : '\n(dosya boş)'}`
        }
      }
    })

    tools.push({
      name: 'write_file',
      description:
        'Çalışma alanında bir dosya oluşturur veya tamamen yeniden yazar. ' +
        'Alt klasörler otomatik oluşturulur. Mevcut dosyayı küçük değişiklik için edit_file kullan.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Çalışma alanına göreli dosya yolu.' },
          content: { type: 'string', description: 'Dosyanın tam içeriği.' }
        },
        required: ['path', 'content']
      },
      summary: (args) => `Dosya yaz: ${str(args.path)} (${Buffer.byteLength(str(args.content), 'utf8')} b)`,
      execute: async (args, ctx) => {
        const content = str(args.content)
        const result = await writeWorkspaceFile(
          str(args.path),
          content,
          sessionId,
          ctx.checkpointId
        )
        const diff = result.diff ? `\n\n${result.diff.slice(0, 12_000)}` : ''
        const format = await applyFormatHook(result.path)
        return {
          ok: true,
          content: `Yazıldı: ${result.path} (${result.bytes} bayt)${diff}${format}`,
          checkpointId: result.checkpointId
        }
      }
    })

    tools.push({
      name: 'edit_file',
      description:
        'Bir dosyada birebir eşleşen metni değiştirir. old_string dosyada benzersiz olmalı; ' +
        'birden fazla eşleşme varsa replace_all=true kullan veya daha fazla bağlam ekle.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Çalışma alanına göreli dosya yolu.' },
          old_string: { type: 'string', description: 'Değiştirilecek mevcut metin (birebir).' },
          new_string: { type: 'string', description: 'Yeni metin.' },
          replace_all: { type: 'boolean', description: 'Tüm eşleşmeleri değiştir.' }
        },
        required: ['path', 'old_string', 'new_string']
      },
      summary: (args) => `Dosya düzenle: ${str(args.path)}`,
      execute: async (args, ctx) => {
        const result = await editWorkspaceFile(
          str(args.path),
          str(args.old_string),
          str(args.new_string),
          args.replace_all === true,
          sessionId,
          ctx.checkpointId
        )
        const diff = result.diff ? `\n\n${result.diff.slice(0, 12_000)}` : ''
        const format = await applyFormatHook(result.path)
        return {
          ok: true,
          content: `Düzenlendi: ${result.path} (${result.bytes} bayt)${diff}${format}`,
          checkpointId: result.checkpointId
        }
      }
    })

    tools.push({
      name: 'delete_file',
      description: 'Çalışma alanındaki bir dosyayı siler. Bu işlem geri alınabilir.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Çalışma alanına göreli dosya yolu.' }
        },
        required: ['path']
      },
      summary: (args) => `Dosya sil: ${str(args.path)}`,
      execute: async (args, ctx) => {
        const result = await deleteWorkspaceFile(str(args.path), sessionId, ctx.checkpointId)
        return {
          ok: true,
          content: `Silindi: ${result.path}`,
          checkpointId: result.checkpointId
        }
      }
    })

    tools.push({
      name: 'create_directory',
      description: 'Çalışma alanında bir klasör (ve gerekli üst klasörleri) oluşturur.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Çalışma alanına göreli klasör yolu.' }
        },
        required: ['path']
      },
      summary: (args) => `Klasör oluştur: ${str(args.path)}`,
      execute: async (args, ctx) => {
        const result = await makeWorkspaceDirectory(
          str(args.path),
          sessionId,
          ctx.checkpointId
        )
        return {
          ok: true,
          content: `Klasör oluşturuldu: ${result.path}`,
          checkpointId: result.checkpointId
        }
      }
    })

    tools.push({
      name: 'list_files',
      description:
        'Çalışma alanının dosya ağacını listeler. Büyük projelerde glob veya grep daha verimlidir.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'İsteğe bağlı alt klasör yolu.' }
        }
      },
      summary: (args) => `Dosyaları listele${str(args.path) ? `: ${str(args.path)}` : ''}`,
      execute: async (args) => {
        const tree = await getWorkspaceTree()
        const filter = str(args.path)
        if (!filter) {
          return { ok: true, content: formatTree(tree) || '(çalışma alanı boş)' }
        }
        const node = findTreeEntry(tree, filter)
        if (!node) return { ok: false, content: `Klasör bulunamadı: ${filter}` }
        if (node.type === 'file') {
          return { ok: true, content: `📄 ${node.path}` }
        }
        return { ok: true, content: formatTree(node.children ?? []) || '(klasör boş)' }
      }
    })

    tools.push({
      name: 'glob',
      description:
        'Dosya yollarını glob deseniyle arar (örn. "**/*.ts", "src/**/*.tsx", "*.json").',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob deseni.' },
          path: { type: 'string', description: 'İsteğe bağlı başlangıç klasörü.' }
        },
        required: ['pattern']
      },
      summary: (args) => `Glob: ${str(args.pattern)}`,
      execute: async (args) => {
        const files = await globWorkspace(str(args.pattern), str(args.path) || undefined)
        return {
          ok: true,
          content: files.length > 0 ? files.join('\n') : 'Eşleşen dosya yok.'
        }
      }
    })

    tools.push({
      name: 'grep',
      description:
        'Çalışma alanındaki dosyalarda düzenli ifade arar ve "dosya:satır: metin" döndürür.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Düzenli ifade.' },
          path: { type: 'string', description: 'İsteğe bağlı başlangıç klasörü.' },
          include: { type: 'string', description: 'Dosya filtresi (örn. "*.ts").' },
          ignore_case: { type: 'boolean', description: 'Büyük/küçük harf duyarsız ara.' }
        },
        required: ['pattern']
      },
      summary: (args) => `Grep: ${str(args.pattern)}`,
      execute: async (args) => {
        const results = await grepWorkspace(
          str(args.pattern),
          str(args.path) || undefined,
          str(args.include) || undefined,
          args.ignore_case === true
        )
        return {
          ok: true,
          content: results.length > 0 ? results.join('\n') : 'Eşleşme yok.'
        }
      }
    })

    tools.push({
      name: 'repo_map',
      category: 'read',
      description:
        'Kod tabanının dosya ve sembol haritasını çıkarır (fonksiyon, sınıf, tip, export). ' +
        'Bilinmeyen bir projede önce bunu kullan; ardından ilgili dosyaları read_file/grep ile aç. ' +
        'query ile dosya yolu veya sembol adına göre filtreleyebilirsin.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Dosya yolu veya sembol filtresi.' },
          max_files: { type: 'number', description: 'En fazla dosya sayısı (varsayılan 300).' }
        }
      },
      summary: (args) => `Repo map: ${str(args.query) || 'tümü'}`,
      execute: async (args) => {
        const map = await buildRepoMap(
          str(args.query) || undefined,
          Math.max(1, Math.min(600, Math.round(num(args.max_files, 300))))
        )
        return {
          ok: true,
          content:
            `Repo map — ${map.fileCount} dosya, ${map.symbolCount} sembol` +
            `${map.truncated ? ' (kısaltıldı)' : ''}\n\n${map.text}`.slice(0, 30_000)
        }
      }
    })

    tools.push({
      name: 'code_search',
      category: 'read',
      description:
        'Anlamsal kod araması yapar. Kullanıcı Dosyalar > Ara panelinden indeks oluşturmuş olmalıdır. ' +
        'Doğal dil sorgusuyla ilgili kod parçalarını dosya:satır ve skorla döndürür.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Doğal dil arama sorgusu.' },
          top_k: { type: 'number', description: 'Döndürülecek sonuç sayısı (varsayılan 8).' }
        },
        required: ['query']
      },
      summary: (args) => `Kod ara: ${str(args.query).slice(0, 80)}`,
      execute: async (args) => {
        try {
          const results = await searchCodeIndex(
            str(args.query),
            Math.max(1, Math.min(20, Math.round(num(args.top_k, 8))))
          )
          return {
            ok: true,
            content:
              results
                .map(
                  (result) =>
                    `${result.path}:${result.startLine}-${result.endLine} (skor ${result.score.toFixed(3)})\n${result.preview}`
                )
                .join('\n\n---\n\n') || 'Sonuç bulunamadı.'
          }
        } catch (error) {
          return {
            ok: false,
            content: error instanceof Error ? error.message : String(error)
          }
        }
      }
    })

    tools.push({
      name: 'run_command',
      description:
        'Çalışma alanında bir kabuk komutu çalıştırır (Windows PowerShell / Unix sh). ' +
        'Çıktıyı, hata çıktısını ve çıkış kodunu döndürür. Uzun süren komutlarda timeout_ms ver.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Çalıştırılacak komut.' },
          timeout_ms: { type: 'number', description: 'Zaman aşımı (ms, varsayılan 60000).' }
        },
        required: ['command']
      },
      summary: (args) => `Komut: ${str(args.command).slice(0, 100)}`,
      execute: async (args) => {
        const result = await runWorkspaceCommand(str(args.command), num(args.timeout_ms, 60_000))
        const parts = [
          `Komut: ${result.command}`,
          `Çıkış kodu: ${result.exitCode}`,
          `--- stdout ---`,
          result.stdout || '(boş)',
          `--- stderr ---`,
          result.stderr || '(boş)'
        ]
        return { ok: result.exitCode === 0, content: parts.join('\n') }
      }
    })

    tools.push({
      name: 'run_checks',
      description:
        'Projede tanımlı typecheck, lint, test ve build scriptlerini çalıştırır. ' +
        'Dosya düzenledikten sonra hataları yakalamak için kullan. names verilmezse tümü çalışır.',
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Çalıştırılacak kontroller: typecheck, lint, test, build.'
          }
        }
      },
      summary: (args) => {
        const names = Array.isArray(args.names) ? args.names.map(String) : []
        return names.length > 0 ? `Kontroller: ${names.join(', ')}` : 'Tüm kontrolleri çalıştır'
      },
      execute: async (args) => {
        const available = await detectProjectChecks()
        if (available.length === 0) {
          return {
            ok: false,
            content:
              'Projede tanımlı kontrol bulunamadı. package.json içine typecheck/lint/test scriptleri ekleyin.'
          }
        }
        const names = Array.isArray(args.names) ? args.names.map(String) : undefined
        const results = await runProjectChecks(names)
        const ok = results.length > 0 && results.every((result) => result.ok)
        const content = results
          .map(
            (result) =>
              `${result.ok ? '✓' : '✗'} ${result.label} (${result.command}) — çıkış ${result.exitCode}\n${result.output}`
          )
          .join('\n\n')
        return { ok, content: content.slice(0, 20_000) }
      }
    })

    tools.push({
      name: 'git',
      category: 'execute',
      description:
        'Git işlemleri. action: status, diff, stage, unstage, commit, branches, remotes, push, pr_status, pr_create, worktree_list, worktree_add, worktree_remove. ' +
        'Stage/commit öncesi status ve diff ile değişiklikleri incele. Push/PR yalnızca kullanıcı açıkça isterse yapılmalı. ' +
        'Worktree, oturumu izole bir çalışma kopyasında çalıştırmak içindir.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'status',
              'diff',
              'stage',
              'unstage',
              'commit',
              'branches',
              'remotes',
              'push',
              'pr_status',
              'pr_create',
              'worktree_list',
              'worktree_add',
              'worktree_remove'
            ]
          },
          path: { type: 'string', description: 'Diff/stage için dosya yolu.' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Stage/unstage edilecek dosyalar.'
          },
          staged: { type: 'boolean', description: 'Diff için stage edilmiş değişiklikler.' },
          message: { type: 'string', description: 'Commit mesajı.' },
          branch: { type: 'string', description: 'Worktree için branch adı.' },
          remote: { type: 'string', description: 'Push için remote adı (varsayılan origin).' },
          title: { type: 'string', description: 'PR başlığı.' },
          body: { type: 'string', description: 'PR açıklaması.' }
        },
        required: ['action']
      },
      summary: (args) => `Git: ${str(args.action)}`,
      execute: async (args) => {
        const action = str(args.action)
        const paths = Array.isArray(args.paths) ? args.paths.map(String) : []
        try {
          if (action === 'status') {
            const status = await getGitStatus()
            return { ok: true, content: JSON.stringify(status, null, 2) }
          }
          if (action === 'diff') {
            return {
              ok: true,
              content: await getGitDiff(str(args.path) || undefined, args.staged === true)
            }
          }
          if (action === 'stage') {
            const result = await stageGitPaths(paths.length > 0 ? paths : undefined)
            return { ok: result.ok, content: result.output }
          }
          if (action === 'unstage') {
            const result = await unstageGitPaths(paths.length > 0 ? paths : undefined)
            return { ok: result.ok, content: result.output }
          }
          if (action === 'commit') {
            const result = await commitGit(str(args.message))
            return { ok: result.ok, content: result.output }
          }
          if (action === 'branches') {
            return { ok: true, content: (await listGitBranches()).join('\n') || '(branch yok)' }
          }
          if (action === 'remotes') {
            return {
              ok: true,
              content: JSON.stringify(await listGitRemotes(), null, 2)
            }
          }
          if (action === 'push') {
            const result = await pushGit(str(args.remote) || undefined)
            return {
              ok: true,
              content: `${result.branch} -> ${result.remote}\n${result.output}`
            }
          }
          if (action === 'pr_status') {
            return { ok: true, content: JSON.stringify(await getGitPrStatus(), null, 2) }
          }
          if (action === 'pr_create') {
            const result = await createGitPr(
              str(args.title) || str(args.message),
              str(args.body) || undefined
            )
            return { ok: result.ok, content: result.output }
          }
          if (action === 'worktree_list') {
            return {
              ok: true,
              content: JSON.stringify(await listGitWorktrees(), null, 2)
            }
          }
          if (action === 'worktree_add') {
            const result = await addGitWorktree(str(args.branch))
            return {
              ok: true,
              content: `Worktree oluşturuldu: ${result.path} (${result.branch})\n${result.output}`
            }
          }
          if (action === 'worktree_remove') {
            const result = await removeGitWorktree(str(args.path))
            return { ok: result.ok, content: result.output }
          }
          return { ok: false, content: `Bilinmeyen git action: ${action}` }
        } catch (error) {
          return {
            ok: false,
            content: `Git hatası: ${error instanceof Error ? error.message : String(error)}`
          }
        }
      }
    })
  }

  tools.push({
    name: 'question',
    category: 'read',
    description:
      'Kullanıcıya seçenekli bir soru sorar ve yanıtını bekler. Belirsiz bir tercih, ' +
      'hedef veya onay gerektiğinde kullan. Seçenek yoksa kullanıcı serbest metin girebilir.',
    parameters: {
      type: 'object',
      properties: {
        header: { type: 'string', description: 'Kısa başlık (en fazla 30 karakter).' },
        question: { type: 'string', description: 'Kullanıcıya gösterilecek soru.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Seçenekler. Boş bırakılırsa yalnızca serbest metin sorulur.'
        },
        multiple: {
          type: 'boolean',
          description: 'Birden fazla seçenek seçilebilir mi?'
        }
      },
      required: ['question']
    },
    summary: (args) => `Soru: ${str(args.question).slice(0, 100)}`,
    execute: async (args, ctx) => {
      const questionId = randomUUID()
      const rawOptions = Array.isArray(args.options) ? args.options : []
      const options = rawOptions
        .map((value) => {
          if (typeof value === 'string') return { label: value.trim() }
          if (value && typeof value === 'object') {
            const item = value as { label?: unknown; description?: unknown }
            const label = str(item.label).trim()
            if (!label) return null
            return {
              label,
              description: str(item.description).trim() || undefined
            }
          }
          return null
        })
        .filter((value): value is { label: string; description?: string } => !!value)
        .slice(0, 12)

      ctx.send({
        requestId: ctx.requestId,
        type: 'question',
        request: {
          requestId: ctx.requestId,
          question: {
            id: questionId,
            header: str(args.header, 'Soru').slice(0, 60),
            question: str(args.question),
            options,
            multiple: args.multiple === true
          }
        }
      })

      const answers = await waitForQuestion(
        ctx.requestId,
        questionId,
        ctx.signal ?? new AbortController().signal
      )
      if (!answers || answers.length === 0) {
        return { ok: false, content: 'Kullanıcı soruyu yanıtlamadı veya iptal etti.' }
      }
      return { ok: true, content: `Kullanıcı yanıtı: ${answers.join(', ')}` }
    }
  })

  tools.push({
    name: 'webfetch',
    category: 'read',
    description:
      'Bir HTTP/HTTPS URLsinin içeriğini metin olarak getirir. Dokümantasyon, API yanıtı veya ' +
      'hata sayfası okumak için kullan. Yerel/özel ağ adresleri engellenir.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Getirilecek http(s) URL.' },
        format: {
          type: 'string',
          enum: ['text', 'html'],
          description: 'Dönen içerik biçimi (varsayılan text).'
        },
        max_chars: {
          type: 'number',
          description: 'Döndürülecek maksimum karakter (varsayılan 120000).'
        },
        timeout_ms: {
          type: 'number',
          description: 'Zaman aşımı (ms, varsayılan 30000, maksimum 120000).'
        }
      },
      required: ['url']
    },
    summary: (args) => `Web: ${str(args.url).slice(0, 100)}`,
    execute: async (args) => {
      const raw = str(args.url).trim()
      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        return { ok: false, content: `Geçersiz URL: ${raw}` }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, content: 'Yalnızca http:// ve https:// desteklenir.' }
      }
      const host = parsed.hostname.toLowerCase()
      if (
        host === 'localhost' ||
        host === '::1' ||
        host.endsWith('.local') ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        return { ok: false, content: 'Yerel/özel ağ adreslerine erişim engellendi.' }
      }
      const timeout = Math.min(120000, Math.max(1000, num(args.timeout_ms, 30_000)))
      const maxChars = Math.min(200_000, Math.max(1000, num(args.max_chars, 120_000)))
      try {
        const response = await fetch(parsed.toString(), {
          redirect: 'follow',
          signal: AbortSignal.timeout(timeout),
          headers: {
            'User-Agent': 'EVREN-Desktop/webfetch',
            Accept: 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5'
          }
        })
        const body = await response.text()
        const head = [
          `URL: ${response.url || parsed.toString()}`,
          `HTTP: ${response.status} ${response.statusText}`,
          `Content-Type: ${response.headers.get('content-type') ?? 'bilinmiyor'}`
        ].join('\n')
        const content = body.slice(0, maxChars)
        return {
          ok: response.ok,
          content: `${head}\n\n${content}${body.length > maxChars ? '\n\n[çıktı kısaltıldı]' : ''}`
        }
      } catch (error) {
        return {
          ok: false,
          content: `Web isteği başarısız: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }
  })

  if (browser) {
    tools.push({
      name: 'browser_open',
      description:
        'Tarayıcıyı açar ve verilen URLye gider. Sayfanın başlığını, metnini ve etkileşimli öğelerini (ref) döndürür.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Açılacak https URL.' }
        },
        required: ['url']
      },
      summary: (args) => `Tarayıcıda aç: ${str(args.url)}`,
      execute: async (args) => {
        const url = str(args.url)
        if (!/^https?:\/\//i.test(url)) throw new Error('Yalnızca http(s) URL desteklenir.')
        const content = await browser.open(url)
        return { ok: true, content }
      }
    })

    tools.push({
      name: 'browser_snapshot',
      description:
        'Açık sayfanın güncel metnini ve etkileşimli öğelerini (ref ile) döndürür. Eylemden önce kullan.',
      parameters: { type: 'object', properties: {} },
      summary: () => 'Tarayıcı anlık görüntüsü al',
      execute: async () => ({ ok: true, content: await browser.snapshot() })
    })

    tools.push({
      name: 'browser_click',
      description:
        'Sayfada bir öğeye tıklar. snapshot içindeki ref, görünür metin veya CSS selector kullanılabilir.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'snapshot içindeki ref numarası.' },
          text: { type: 'string', description: 'Tıklanacak öğenin görünür metni.' },
          selector: { type: 'string', description: 'CSS selector.' }
        }
      },
      summary: (args) =>
        `Tarayıcıda tıkla: ${str(args.ref) ? `ref ${str(args.ref)}` : str(args.text) || str(args.selector)}`,
      execute: async (args) => ({ ok: true, content: await browser.click(args) })
    })

    tools.push({
      name: 'browser_type',
      description: 'Bir form alanına metin yazar. submit=true ise Enter basar.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          submit: { type: 'boolean' }
        },
        required: ['text']
      },
      summary: (args) => `Tarayıcıya yaz: "${str(args.text).slice(0, 60)}"`,
      execute: async (args) => ({ ok: true, content: await browser.type(args) })
    })

    tools.push({
      name: 'browser_key',
      description: 'Tarayıcıda klavye tuşuna basar (örn. Enter, Control+L).',
      parameters: {
        type: 'object',
        properties: { keys: { type: 'string' } },
        required: ['keys']
      },
      summary: (args) => `Tarayıcı tuşu: ${str(args.keys)}`,
      execute: async (args) => ({ ok: true, content: await browser.pressKey(str(args.keys)) })
    })

    tools.push({
      name: 'browser_screenshot',
      description: 'Tarayıcı sayfasının ekran görüntüsünü döndürür.',
      parameters: { type: 'object', properties: {} },
      summary: () => 'Tarayıcı ekran görüntüsü',
      execute: async () => ({
        ok: true,
        content: 'Tarayıcı ekran görüntüsü alındı.',
        imageDataUrl: await browser.screenshot()
      })
    })
  }

  if (options.computer) {
    tools.push({
      name: 'computer_screenshot',
      description:
        'Masaüstünün tam ekran görüntüsünü alır. Koordinatlar için ekran boyutunu da döndürür.',
      parameters: { type: 'object', properties: {} },
      summary: () => 'Masaüstü ekran görüntüsü al',
      execute: async () => {
        const shot = await captureScreen()
        return {
          ok: true,
          content: `Ekran görüntüsü alındı (${shot.width}x${shot.height}).`,
          imageDataUrl: shot.dataUrl
        }
      }
    })

    tools.push({
      name: 'computer_click',
      description:
        'Masaüstünde verilen ekran koordinatına fare tıklaması yapar. Koordinatlar ekran görüntüsü pikselidir.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          button: { type: 'string', enum: ['left', 'right', 'middle'] },
          count: { type: 'number', description: 'Tıklama sayısı (çift tık için 2).' }
        },
        required: ['x', 'y']
      },
      summary: (args) =>
        `Fare tıkla (${requireNumber(args, 'x')}, ${requireNumber(args, 'y')})`,
      execute: async (args) => {
        await runComputerCommand({
          cmd: 'click',
          x: requireNumber(args, 'x'),
          y: requireNumber(args, 'y'),
          button: str(args.button, 'left'),
          count: Math.max(1, Math.min(3, Math.round(num(args.count, 1))))
        })
        return { ok: true, content: 'Tıklama yapıldı.' }
      }
    })

    tools.push({
      name: 'computer_move',
      description: 'Fare imlecini verilen koordinata taşır.',
      parameters: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y']
      },
      summary: (args) => `Fareyi taşı (${requireNumber(args, 'x')}, ${requireNumber(args, 'y')})`,
      execute: async (args) => {
        await runComputerCommand({
          cmd: 'move',
          x: requireNumber(args, 'x'),
          y: requireNumber(args, 'y')
        })
        return { ok: true, content: 'İmleç taşındı.' }
      }
    })

    tools.push({
      name: 'computer_type',
      description: 'Etkin pencereye metin yazar (pano üzerinden yapıştırır).',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      summary: (args) => `Yaz: "${str(args.text).slice(0, 60)}"`,
      execute: async (args) => {
        const text = str(args.text)
        if (!text) throw new Error('text gerekli.')
        await runComputerCommand({ cmd: 'type', text })
        return { ok: true, content: 'Metin yazıldı.' }
      }
    })

    tools.push({
      name: 'computer_key',
      description: 'Etkin pencereye tuş kombinasyonu gönderir (örn. ENTER, CTRL+S).',
      parameters: {
        type: 'object',
        properties: { keys: { type: 'string' } },
        required: ['keys']
      },
      summary: (args) => `Tuş: ${str(args.keys)}`,
      execute: async (args) => {
        const keys = str(args.keys)
        if (!keys) throw new Error('keys gerekli.')
        await runComputerCommand({ cmd: 'key', keys: toSendKeys(keys) })
        return { ok: true, content: 'Tuş gönderildi.' }
      }
    })

    tools.push({
      name: 'computer_scroll',
      description: 'Fare tekerleğiyle kaydırır. Negatif aşağı, pozitif yukarı.',
      parameters: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount']
      },
      summary: (args) => `Kaydır: ${Math.round(num(args.amount, 0))}`,
      execute: async (args) => {
        await runComputerCommand({ cmd: 'scroll', amount: Math.round(num(args.amount, 0)) })
        return { ok: true, content: 'Kaydırma yapıldı.' }
      }
    })
  }

  for (const tool of tools) {
    if (!tool.category) tool.category = toolCategory(tool.name)
  }
  const readOnlyBlocked = new Set([
    'write_file',
    'edit_file',
    'delete_file',
    'create_directory',
    'run_command',
    'run_checks',
    'git',
    'browser_click',
    'browser_type',
    'browser_key'
  ])
  const activeTools = options.readOnly
    ? tools.filter(
        (tool) => !readOnlyBlocked.has(tool.name) && !tool.name.startsWith('computer_')
      )
    : tools
  const byName = new Map(activeTools.map((tool) => [tool.name, tool]))

  return {
    definitions: () =>
      activeTools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      })),
    get: (name) => byName.get(name),
    dispose: async () => {
      if (browser) await browser.close()
    }
  }
}
