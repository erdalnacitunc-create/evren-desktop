import { ipcMain, dialog, safeStorage, shell, BrowserWindow, Notification } from 'electron'
import { appIconPath } from './appIcon'
import { promises as fs } from 'fs'
import { ApiError, getQuota, listModels } from './api'
import { abortChat, startChat } from './chat'
import { approvalKey, resolveApproval } from './agent/approval'
import {
  cancelSubagentTask,
  getSubagentTask,
  listSubagentTasks,
  retrySubagentTask
} from './agent/taskManager'
import {
  apiKeySource,
  clearApiKey,
  clearGithubToken,
  githubTokenHint,
  loadApiKey,
  loadGithubToken,
  maskKey,
  regenerateHeadlessToken,
  saveApiKey,
  saveGithubToken
} from './credentials'
import {
  installFromGithub,
  inspectRepository,
  removeInstalledExtension,
  setInstalledExtensionEnabled
} from './extensions'
import { listExtensions } from './extensions/store'
import { getExtension, updateExtensionConfig } from './extensions/store'
import {
  interruptTerminal,
  runTerminalCode,
  startTerminal,
  stopTerminal,
  terminalStatus,
  writeTerminal
} from './terminal'
import {
  connectGithubAccount,
  disconnectGithubAccount,
  getGithubAccount,
  listGithubRepos,
  pollGithubDeviceFlow,
  startGithubDeviceFlow
} from './github'
import {
  connectGithubAppInstallation,
  disconnectGithubApp,
  githubAppStatus,
  listGithubAppInstallations,
  refreshGithubAppToken,
  saveGithubAppCredentials
} from './githubApp'
import { connectMcp, disconnectMcp, logoutMcp, mcpStatuses } from './mcp/manager'
import {
  callMcpTool,
  callMcpToolAsTask,
  cancelMcpTask,
  getMcpPrompt,
  getMcpTaskResult,
  listMcpPrompts,
  listMcpResources,
  listMcpTasks,
  listMcpTools,
  readMcpResource,
  respondMcpElicitation
} from './mcp/manager'
import { loadPlugin, pluginStatuses, unloadPlugin } from './plugins/manager'
import { compactSession } from './compaction/service'
import { transcribeAudio } from './audio'
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  runScheduledTaskNow,
  updateScheduledTask
} from './scheduler'
import { detectProjectChecks, runProjectChecks } from './checks'
import { buildRepoMap } from './repoMap'
import { buildCodeIndex, getCodeIndexStatus, searchCodeIndex } from './codeIndex'
import {
  addGitWorktree,
  commitGit,
  createGitPr,
  getGhStatus,
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
} from './git'
import { openExternalSafe } from './safeOpen'
import { getSkillContent, listCommands } from './commands'
import { learnFromSession } from './memory/extract'
import {
  addMemory,
  clearMemories,
  deleteMatching,
  deleteMemory,
  getInstructions,
  getMemorySettings,
  listMemories,
  setInstructions,
  updateMemory,
  updateMemorySettings
} from './memory/store'
import { getSettings, setBaseUrl, updateSettings } from './settings'
import {
  applyHeadlessSettings,
  headlessStatus,
  restartHeadlessServer
} from './headless'
import {
  clearWorkspacePath,
  getWorkspaceInfo,
  getWorkspaceTree,
  listWorkspaceChanges,
  listWorkspaceCheckpoints,
  readWorkspaceFile,
  restoreWorkspaceCheckpoint,
  setWorkspacePath,
  undoWorkspaceChange
} from './workspace'
import {
  appendMessage,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  renameSession,
  searchSessions,
  setSessionModel,
  setSessionTodos
} from './sessionStore'
import { PERMISSION_CATEGORIES } from '../shared/permissions'
import type {
  AppSettings,
  ChatRequest,
  CheckResult,
  CodeIndexStatus,
  CodeSearchResult,
  CompactionResult,
  GitCommandResult,
  GitGhStatus,
  GitPrStatus,
  GitPushResult,
  GitRemote,
  GitStatus,
  GitWorktree,
  GitWorktreeAddResult,
  GithubAccount,
  GithubDeviceCode,
  GithubDevicePoll,
  GithubRepo,
  GithubAppInstallation,
  GithubAppStatus,
  HeadlessStatus,
  InstalledExtension,
  KeyStatus,
  McpElicitationAction,
  McpElicitationResponse,
  McpPromptInfo,
  McpPromptResult,
  McpResourceContent,
  McpResourceInfo,
  McpServerStatus,
  McpTaskInfo,
  McpToolInfo,
  MemoryEntry,
  MemorySettings,
  ModelInfo,
  PermissionCategory,
  PluginStatus,
  ProjectCheck,
  QuotaStatus,
  RepoInspection,
  RepoMapResult,
  Result,
  ScheduledTask,
  ScheduledTaskInput,
  Session,
  SessionSummary,
  SlashCommand,
  StoredMessage,
  SubagentTaskInfo,
  TerminalStatus,
  WorkspaceChange,
  WorkspaceCheckpoint,
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceInfo,
  WorkspaceRestoreResult,
  WorkspaceUndoResult
} from '../shared/types'

function fail(error: unknown): Result<never> {
  if (error instanceof ApiError) {
    return { ok: false, error: error.message, status: error.status }
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

async function requireCredentials(): Promise<{ key: string; baseUrl: string }> {
  const [key, settings] = await Promise.all([loadApiKey(), getSettings()])
  if (!key) throw new ApiError('API anahtarı bulunamadı. Lütfen anahtarınızı ekleyin.')
  return { key, baseUrl: settings.baseUrl }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:ping', () => ({
    ok: true,
    app: 'EVREN Desktop',
    version: process.env['npm_package_version'] ?? '0.1.0',
    platform: process.platform,
    time: new Date().toISOString()
  }))

  ipcMain.handle('window:minimize', (event): Result<true> => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
    return { ok: true, data: true }
  })

  ipcMain.handle('window:toggleMaximize', (event): Result<boolean> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { ok: true, data: false }
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return { ok: true, data: window.isMaximized() }
  })

  ipcMain.handle('window:isMaximized', (event): Result<boolean> => {
    return { ok: true, data: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false }
  })

  ipcMain.handle('window:close', (event): Result<true> => {
    BrowserWindow.fromWebContents(event.sender)?.close()
    return { ok: true, data: true }
  })

  ipcMain.handle('key:status', async (): Promise<Result<KeyStatus>> => {
    const key = await loadApiKey()
    return {
      ok: true,
      data: {
        hasKey: !!key,
        hint: key ? maskKey(key) : null,
        source: key ? apiKeySource() : null,
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      }
    }
  })

  ipcMain.handle('key:validate', async (_event, raw: string): Promise<Result<ModelInfo[]>> => {
    try {
      const { baseUrl } = await getSettings()
      const models = await listModels(baseUrl, String(raw ?? '').trim())
      return { ok: true, data: models }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('key:save', async (_event, raw: string): Promise<Result<{ hint: string }>> => {
    try {
      const key = String(raw ?? '').trim()
      await saveApiKey(key)
      return { ok: true, data: { hint: maskKey(key) } }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('key:clear', async (): Promise<Result<true>> => {
    try {
      await clearApiKey()
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('models:list', async (): Promise<Result<ModelInfo[]>> => {
    try {
      const { key, baseUrl } = await requireCredentials()
      return { ok: true, data: await listModels(baseUrl, key) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'audio:transcribe',
    async (_event, payload: unknown): Promise<Result<{ text: string; model: string }>> => {
      try {
        const input = (payload ?? {}) as {
          data?: ArrayBuffer
          mimeType?: string
          filename?: string
          language?: string
          model?: string
        }
        if (!(input.data instanceof ArrayBuffer)) {
          throw new Error('Geçersiz ses verisi.')
        }
        return {
          ok: true,
          data: await transcribeAudio({
            data: input.data,
            mimeType: String(input.mimeType ?? 'audio/webm'),
            filename: input.filename ? String(input.filename) : undefined,
            language: input.language ? String(input.language) : undefined,
            model: input.model ? String(input.model) : undefined
          })
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('quota:get', async (): Promise<Result<QuotaStatus>> => {
    try {
      const { key, baseUrl } = await requireCredentials()
      return { ok: true, data: await getQuota(baseUrl, key) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'chat:start',
    async (event, payload: ChatRequest): Promise<Result<{ requestId: string }>> => {
      try {
        return { ok: true, data: await startChat(event.sender.id, payload) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('chat:abort', async (_event, requestId: string): Promise<Result<boolean>> => {
    try {
      return { ok: true, data: abortChat(String(requestId ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'agent:approve',
    async (
      _event,
      requestId: string,
      toolCallId: string,
      approved: boolean,
      always?: boolean,
      category?: PermissionCategory
    ): Promise<Result<boolean>> => {
      try {
        const key = approvalKey(String(requestId ?? ''), String(toolCallId ?? ''))
        const resolved = resolveApproval(key, approved === true)
        if (
          resolved &&
          approved === true &&
          always === true &&
          category &&
          PERMISSION_CATEGORIES.includes(category)
        ) {
          const settings = await getSettings()
          await updateSettings({
            permissions: { ...(settings.permissions ?? {}), [category]: 'allow' }
          })
        }
        return { ok: true, data: resolved }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('sessions:list', async (): Promise<Result<SessionSummary[]>> => {
    try {
      return { ok: true, data: await listSessions() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('sessions:search', async (_event, query: string): Promise<Result<SessionSummary[]>> => {
    try {
      return { ok: true, data: await searchSessions(String(query ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('sessions:get', async (_event, id: string): Promise<Result<Session | null>> => {
    try {
      return { ok: true, data: await getSession(String(id ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('sessions:create', async (_event, modelId: string): Promise<Result<Session>> => {
    try {
      return { ok: true, data: await createSession(String(modelId ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'sessions:append',
    async (_event, sessionId: string, message: StoredMessage): Promise<Result<Session | null>> => {
      try {
        return { ok: true, data: await appendMessage(String(sessionId ?? ''), message) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sessions:rename',
    async (_event, sessionId: string, title: string): Promise<Result<Session | null>> => {
      try {
        return { ok: true, data: await renameSession(String(sessionId ?? ''), String(title ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('sessions:delete', async (_event, sessionId: string): Promise<Result<boolean>> => {
    try {
      return { ok: true, data: await deleteSession(String(sessionId ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'sessions:setModel',
    async (_event, sessionId: string, modelId: string): Promise<Result<Session | null>> => {
      try {
        return {
          ok: true,
          data: await setSessionModel(String(sessionId ?? ''), String(modelId ?? ''))
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sessions:setTodos',
    async (_event, sessionId: string, todos: unknown): Promise<Result<Session | null>> => {
      try {
        return {
          ok: true,
          data: await setSessionTodos(
            String(sessionId ?? ''),
            Array.isArray(todos) ? (todos as Parameters<typeof setSessionTodos>[1]) : []
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('settings:get', async (): Promise<Result<AppSettings>> => {
    try {
      return { ok: true, data: await getSettings() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'settings:setBaseUrl',
    async (_event, url: string): Promise<Result<AppSettings>> => {
      try {
        await setBaseUrl(String(url ?? ''))
        return { ok: true, data: await getSettings() }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'settings:update',
    async (_event, patch: Partial<AppSettings>): Promise<Result<AppSettings>> => {
      try {
        return { ok: true, data: await updateSettings(patch ?? {}) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('headless:status', async (): Promise<Result<HeadlessStatus>> => {
    try {
      return { ok: true, data: await headlessStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('terminal:status', async (): Promise<Result<TerminalStatus>> => {
    try {
      return { ok: true, data: terminalStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'terminal:start',
    async (_event, cwd?: string): Promise<Result<TerminalStatus>> => {
      try {
        return { ok: true, data: await startTerminal(cwd ? String(cwd) : undefined) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('terminal:stop', async (): Promise<Result<true>> => {
    try {
      stopTerminal()
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('terminal:interrupt', async (): Promise<Result<true>> => {
    try {
      interruptTerminal()
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'terminal:write',
    async (_event, data: string): Promise<Result<boolean>> => {
      try {
        return { ok: true, data: await writeTerminal(String(data ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'terminal:runCode',
    async (
      _event,
      language: string,
      code: string
    ): Promise<Result<{ ok: boolean; command?: string; label?: string; error?: string }>> => {
      try {
        return {
          ok: true,
          data: await runTerminalCode(String(language ?? ''), String(code ?? ''))
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'headless:configure',
    async (
      _event,
      enabled: boolean,
      port: number
    ): Promise<Result<HeadlessStatus>> => {
      try {
        const settings = await updateSettings({
          headless: { enabled: enabled === true, port: Number(port) || 45871 }
        })
        await applyHeadlessSettings()
        return { ok: true, data: await headlessStatus() }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('headless:regenerateToken', async (): Promise<Result<HeadlessStatus>> => {
    try {
      await regenerateHeadlessToken()
      const settings = await getSettings()
      if (settings.headless?.enabled) {
        await restartHeadlessServer(settings.headless.port)
      }
      return { ok: true, data: await headlessStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('extensions:list', async (): Promise<Result<InstalledExtension[]>> => {
    try {
      return { ok: true, data: await listExtensions() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'extensions:inspect',
    async (_event, url: string): Promise<Result<RepoInspection>> => {
      try {
        const token = await loadGithubToken()
        return { ok: true, data: await inspectRepository(String(url ?? ''), token ?? undefined) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'extensions:install',
    async (
      _event,
      url: string,
      unitIds: string[],
      overrides: Record<string, { command?: string; args?: string[] }> | undefined
    ): Promise<Result<InstalledExtension[]>> => {
      try {
        const token = await loadGithubToken()
        return {
          ok: true,
          data: await installFromGithub(
            String(url ?? ''),
            Array.isArray(unitIds) ? unitIds.map(String) : [],
            token ?? undefined,
            overrides ?? undefined
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'extensions:remove',
    async (_event, id: string): Promise<Result<boolean>> => {
      try {
        return { ok: true, data: await removeInstalledExtension(String(id ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'extensions:setEnabled',
    async (_event, id: string, enabled: boolean): Promise<Result<boolean>> => {
      try {
        return {
          ok: true,
          data: await setInstalledExtensionEnabled(String(id ?? ''), enabled === true)
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'github:tokenStatus',
    async (): Promise<Result<{ hasToken: boolean; hint: string | null }>> => {
      try {
        const token = await loadGithubToken()
        return { ok: true, data: { hasToken: !!token, hint: token ? githubTokenHint() : null } }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('github:account', async (): Promise<Result<GithubAccount>> => {
    try {
      return { ok: true, data: await getGithubAccount() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'github:connect',
    async (_event, token: string): Promise<Result<GithubAccount>> => {
      try {
        return { ok: true, data: await connectGithubAccount(String(token ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('github:disconnect', async (): Promise<Result<true>> => {
    try {
      await disconnectGithubAccount()
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('github:repos', async (): Promise<Result<GithubRepo[]>> => {
    try {
      return { ok: true, data: await listGithubRepos() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'github:deviceStart',
    async (_event, clientId: string): Promise<Result<GithubDeviceCode>> => {
      try {
        return { ok: true, data: await startGithubDeviceFlow(String(clientId ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'github:devicePoll',
    async (
      _event,
      clientId: string,
      deviceCode: string
    ): Promise<Result<GithubDevicePoll>> => {
      try {
        return {
          ok: true,
          data: await pollGithubDeviceFlow(String(clientId ?? ''), String(deviceCode ?? ''))
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('githubApp:status', async (): Promise<Result<GithubAppStatus>> => {
    try {
      return { ok: true, data: await githubAppStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'githubApp:saveCredentials',
    async (
      _event,
      appId: string,
      privateKey: string
    ): Promise<Result<GithubAppStatus>> => {
      try {
        return {
          ok: true,
          data: await saveGithubAppCredentials(
            String(appId ?? ''),
            String(privateKey ?? '')
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'githubApp:installations',
    async (): Promise<Result<GithubAppInstallation[]>> => {
      try {
        return { ok: true, data: await listGithubAppInstallations() }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'githubApp:connect',
    async (_event, installationId: number): Promise<Result<GithubAppStatus>> => {
      try {
        return {
          ok: true,
          data: await connectGithubAppInstallation(Number(installationId))
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('githubApp:refresh', async (): Promise<Result<GithubAppStatus>> => {
    try {
      return { ok: true, data: await refreshGithubAppToken() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('githubApp:disconnect', async (): Promise<Result<GithubAppStatus>> => {
    try {
      return { ok: true, data: await disconnectGithubApp() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('github:setToken', async (_event, token: string): Promise<Result<true>> => {
    try {
      await saveGithubToken(String(token ?? ''))
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('mcp:status', async (): Promise<Result<McpServerStatus[]>> => {
    try {
      return { ok: true, data: mcpStatuses() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'mcp:connect',
    async (_event, id: string): Promise<Result<McpServerStatus>> => {
      try {
        const extension = await getExtension(String(id ?? ''))
        if (!extension) throw new Error('Uzantı bulunamadı.')
        return { ok: true, data: await connectMcp(extension) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('mcp:disconnect', async (_event, id: string): Promise<Result<true>> => {
    try {
      await disconnectMcp(String(id ?? ''))
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('mcp:logout', async (_event, id: string): Promise<Result<true>> => {
    try {
      await logoutMcp(String(id ?? ''))
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('mcp:resources', async (): Promise<Result<McpResourceInfo[]>> => {
    try {
      return { ok: true, data: await listMcpResources() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('mcp:tools', async (): Promise<Result<McpToolInfo[]>> => {
    try {
      return { ok: true, data: await listMcpTools() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'mcp:callTool',
    async (
      _event,
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      taskMode?: boolean
    ): Promise<Result<{ ok: boolean; content: string; task?: McpTaskInfo }>> => {
      try {
        const result = taskMode
          ? await callMcpToolAsTask(String(serverId ?? ''), String(toolName ?? ''), args ?? {})
          : await callMcpTool(String(serverId ?? ''), String(toolName ?? ''), args ?? {})
        return { ok: true, data: result }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'mcp:readResource',
    async (
      _event,
      serverId: string,
      uri: string
    ): Promise<Result<McpResourceContent[]>> => {
      try {
        return { ok: true, data: await readMcpResource(String(serverId ?? ''), String(uri ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('mcp:prompts', async (): Promise<Result<McpPromptInfo[]>> => {
    try {
      return { ok: true, data: await listMcpPrompts() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'mcp:getPrompt',
    async (
      _event,
      serverId: string,
      name: string,
      args: Record<string, string>
    ): Promise<Result<McpPromptResult>> => {
      try {
        return {
          ok: true,
          data: await getMcpPrompt(String(serverId ?? ''), String(name ?? ''), args ?? {})
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('mcp:tasks', async (): Promise<Result<McpTaskInfo[]>> => {
    try {
      return { ok: true, data: await listMcpTasks() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'mcp:cancelTask',
    async (
      _event,
      serverId: string,
      taskId: string
    ): Promise<Result<McpTaskInfo | null>> => {
      try {
        return {
          ok: true,
          data: await cancelMcpTask(String(serverId ?? ''), String(taskId ?? ''))
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'mcp:taskResult',
    async (
      _event,
      serverId: string,
      taskId: string
    ): Promise<Result<{ ok: boolean; content: string }>> => {
      try {
        return {
          ok: true,
          data: await getMcpTaskResult(String(serverId ?? ''), String(taskId ?? ''))
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'mcp:elicitResponse',
    async (
      _event,
      id: string,
      action: McpElicitationAction,
      content?: Record<string, unknown>
    ): Promise<Result<true>> => {
      try {
        const responded = respondMcpElicitation(String(id ?? ''), {
          action,
          content: action === 'accept' ? content : undefined
        })
        if (!responded) throw new Error('Onay isteği bulunamadı veya süresi doldu.')
        return { ok: true, data: true }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('plugins:status', async (): Promise<Result<PluginStatus[]>> => {
    try {
      return { ok: true, data: pluginStatuses() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'plugins:load',
    async (_event, id: string): Promise<Result<PluginStatus>> => {
      try {
        const extension = await getExtension(String(id ?? ''))
        if (!extension) throw new Error('Uzantı bulunamadı.')
        return { ok: true, data: await loadPlugin(extension) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('plugins:unload', async (_event, id: string): Promise<Result<true>> => {
    try {
      await unloadPlugin(String(id ?? ''))
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'extensions:updateConfig',
    async (
      _event,
      id: string,
      config: InstalledExtension['config']
    ): Promise<Result<InstalledExtension | null>> => {
      try {
        const updated = await updateExtensionConfig(String(id ?? ''), config)
        if (updated?.type === 'mcp') {
          await disconnectMcp(updated.id)
        }
        return { ok: true, data: updated }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('commands:list', async (): Promise<Result<SlashCommand[]>> => {
    try {
      return { ok: true, data: await listCommands() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'skills:get',
    async (_event, id: string): Promise<Result<{ id: string; name: string; content: string } | null>> => {
      try {
        return { ok: true, data: await getSkillContent(String(id ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'compaction:run',
    async (_event, sessionId: string, focus?: string): Promise<Result<CompactionResult>> => {
      try {
        const { key, baseUrl } = await requireCredentials()
        return { ok: true, data: await compactSession(String(sessionId ?? ''), baseUrl, key, focus) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('memory:list', async (_event, query?: string): Promise<Result<MemoryEntry[]>> => {
    try {
      return { ok: true, data: await listMemories(query ? String(query) : undefined) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('memory:add', async (_event, input: unknown): Promise<Result<MemoryEntry>> => {
    try {
      return { ok: true, data: await addMemory(input as Parameters<typeof addMemory>[0]) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'memory:update',
    async (_event, id: string, patch: unknown): Promise<Result<MemoryEntry | null>> => {
      try {
        return {
          ok: true,
          data: await updateMemory(String(id ?? ''), patch as Parameters<typeof updateMemory>[1])
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('memory:delete', async (_event, id: string): Promise<Result<boolean>> => {
    try {
      return { ok: true, data: await deleteMemory(String(id ?? '')) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'memory:deleteMatching',
    async (_event, query: string): Promise<Result<number>> => {
      try {
        return { ok: true, data: await deleteMatching(String(query ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('memory:clear', async (): Promise<Result<true>> => {
    try {
      await clearMemories()
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('memory:getInstructions', async (): Promise<Result<string>> => {
    try {
      return { ok: true, data: await getInstructions() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'memory:setInstructions',
    async (_event, text: string): Promise<Result<true>> => {
      try {
        await setInstructions(String(text ?? ''))
        return { ok: true, data: true }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('memory:getSettings', async (): Promise<Result<MemorySettings>> => {
    try {
      return { ok: true, data: await getMemorySettings() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'memory:updateSettings',
    async (_event, patch: Partial<MemorySettings>): Promise<Result<MemorySettings>> => {
      try {
        return { ok: true, data: await updateMemorySettings(patch ?? {}) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'memory:learn',
    async (_event, sessionId: string): Promise<Result<{ added: number; skipped?: string }>> => {
      try {
        const { key, baseUrl } = await requireCredentials()
        return { ok: true, data: await learnFromSession(String(sessionId ?? ''), baseUrl, key) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'artifacts:save',
    async (_event, name: string, content: string): Promise<Result<string | null>> => {
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: String(name ?? 'artifact.txt')
        })
        if (result.canceled || !result.filePath) return { ok: true, data: null }
        await fs.writeFile(result.filePath, String(content ?? ''), 'utf8')
        return { ok: true, data: result.filePath }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('workspace:get', async (): Promise<Result<WorkspaceInfo>> => {
    try {
      return { ok: true, data: await getWorkspaceInfo() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('workspace:choose', async (): Promise<Result<WorkspaceInfo>> => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Çalışma alanı klasörü seç',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: true, data: await getWorkspaceInfo() }
      }
      return { ok: true, data: await setWorkspacePath(result.filePaths[0]) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'workspace:set',
    async (_event, path: string): Promise<Result<WorkspaceInfo>> => {
      try {
        return { ok: true, data: await setWorkspacePath(String(path ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('workspace:clear', async (): Promise<Result<WorkspaceInfo>> => {
    try {
      return { ok: true, data: await clearWorkspacePath() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('workspace:tree', async (): Promise<Result<WorkspaceEntry[]>> => {
    try {
      return { ok: true, data: await getWorkspaceTree() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'workspace:read',
    async (
      _event,
      path: string,
      offset?: number,
      limit?: number
    ): Promise<Result<WorkspaceFileContent>> => {
      try {
        return { ok: true, data: await readWorkspaceFile(String(path ?? ''), offset, limit) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'workspace:changes',
    async (_event, limit?: number): Promise<Result<WorkspaceChange[]>> => {
      try {
        return { ok: true, data: await listWorkspaceChanges(limit) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'workspace:checkpoints',
    async (_event, limit?: number): Promise<Result<WorkspaceCheckpoint[]>> => {
      try {
        return { ok: true, data: await listWorkspaceCheckpoints(limit) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'workspace:restoreCheckpoint',
    async (_event, id: string): Promise<Result<WorkspaceRestoreResult>> => {
      try {
        return { ok: true, data: await restoreWorkspaceCheckpoint(String(id ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'workspace:undo',
    async (_event, id?: string): Promise<Result<WorkspaceUndoResult>> => {
      try {
        return { ok: true, data: await undoWorkspaceChange(id) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('workspace:open', async (): Promise<Result<boolean>> => {
    try {
      const info = await getWorkspaceInfo()
      if (!info.path) throw new Error('Çalışma alanı seçilmedi.')
      const error = await shell.openPath(info.path)
      if (error) throw new Error(error)
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('workspace:checks', async (): Promise<Result<ProjectCheck[]>> => {
    try {
      return { ok: true, data: await detectProjectChecks() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'workspace:runChecks',
    async (_event, names?: string[]): Promise<Result<CheckResult[]>> => {
      try {
        return {
          ok: true,
          data: await runProjectChecks(
            Array.isArray(names) ? names.map((name) => String(name)) : undefined
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'workspace:repoMap',
    async (_event, query?: string, maxFiles?: number): Promise<Result<RepoMapResult>> => {
      try {
        return {
          ok: true,
          data: await buildRepoMap(
            query ? String(query) : undefined,
            typeof maxFiles === 'number' ? maxFiles : undefined
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('codeIndex:status', async (): Promise<Result<CodeIndexStatus>> => {
    try {
      return { ok: true, data: await getCodeIndexStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('codeIndex:build', async (): Promise<Result<CodeIndexStatus>> => {
    try {
      return { ok: true, data: await buildCodeIndex() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'codeIndex:search',
    async (_event, query: string, topK?: number): Promise<Result<CodeSearchResult[]>> => {
      try {
        return {
          ok: true,
          data: await searchCodeIndex(
            String(query ?? ''),
            typeof topK === 'number' ? topK : 8
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('git:status', async (): Promise<Result<GitStatus>> => {
    try {
      return { ok: true, data: await getGitStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'git:diff',
    async (_event, path?: string, staged?: boolean): Promise<Result<string>> => {
      try {
        return {
          ok: true,
          data: await getGitDiff(path ? String(path) : undefined, staged === true)
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'git:stage',
    async (_event, paths?: string[]): Promise<Result<GitCommandResult>> => {
      try {
        return {
          ok: true,
          data: await stageGitPaths(
            Array.isArray(paths) ? paths.map((path) => String(path)) : undefined
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'git:unstage',
    async (_event, paths?: string[]): Promise<Result<GitCommandResult>> => {
      try {
        return {
          ok: true,
          data: await unstageGitPaths(
            Array.isArray(paths) ? paths.map((path) => String(path)) : undefined
          )
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'git:commit',
    async (_event, message: string): Promise<Result<GitCommandResult>> => {
      try {
        return { ok: true, data: await commitGit(String(message ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('git:branches', async (): Promise<Result<string[]>> => {
    try {
      return { ok: true, data: await listGitBranches() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('git:worktrees', async (): Promise<Result<GitWorktree[]>> => {
    try {
      return { ok: true, data: await listGitWorktrees() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'git:worktreeAdd',
    async (_event, branch: string): Promise<Result<GitWorktreeAddResult>> => {
      try {
        return { ok: true, data: await addGitWorktree(String(branch ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'git:worktreeRemove',
    async (_event, path: string): Promise<Result<GitCommandResult>> => {
      try {
        return { ok: true, data: await removeGitWorktree(String(path ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('git:remotes', async (): Promise<Result<GitRemote[]>> => {
    try {
      return { ok: true, data: await listGitRemotes() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'git:push',
    async (_event, remote?: string): Promise<Result<GitPushResult>> => {
      try {
        return { ok: true, data: await pushGit(remote ? String(remote) : undefined) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('git:ghStatus', async (): Promise<Result<GitGhStatus>> => {
    try {
      return { ok: true, data: await getGhStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('git:prStatus', async (): Promise<Result<GitPrStatus>> => {
    try {
      return { ok: true, data: await getGitPrStatus() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'git:prCreate',
    async (_event, title: string, body?: string): Promise<Result<GitCommandResult>> => {
      try {
        return { ok: true, data: await createGitPr(String(title ?? ''), body ? String(body) : undefined) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'app:openExternal',
    async (_event, url: string): Promise<Result<boolean>> => {
      try {
        return { ok: true, data: await openExternalSafe(String(url ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'app:openPath',
    async (_event, path: string): Promise<Result<true>> => {
      try {
        const error = await shell.openPath(String(path ?? ''))
        if (error) throw new Error(error)
        return { ok: true, data: true }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'app:notify',
    async (_event, title: string, body: string): Promise<Result<boolean>> => {
      try {
        if (!Notification.isSupported()) return { ok: true, data: false }
        if (BrowserWindow.getAllWindows().some((window) => window.isFocused())) {
          return { ok: true, data: false }
        }
        new Notification({
          title: String(title || 'EVREN Desktop'),
          body: String(body || ''),
          icon: appIconPath()
        }).show()
        return { ok: true, data: true }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'subagent:list',
    async (_event, sessionId?: string): Promise<Result<SubagentTaskInfo[]>> => {
      try {
        return {
          ok: true,
          data: listSubagentTasks(sessionId ? String(sessionId) : undefined)
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'subagent:cancel',
    async (
      _event,
      taskId: string
    ): Promise<Result<{ cancelled: boolean; task: SubagentTaskInfo | null }>> => {
      try {
        const cancelled = cancelSubagentTask(String(taskId ?? ''))
        return { ok: true, data: { cancelled, task: getSubagentTask(String(taskId ?? '')) } }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'subagent:retry',
    async (_event, taskId: string): Promise<Result<SubagentTaskInfo | null>> => {
      try {
        return { ok: true, data: retrySubagentTask(String(taskId ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('github:clearToken', async (): Promise<Result<true>> => {
    try {
      await clearGithubToken()
      return { ok: true, data: true }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('scheduled:list', async (): Promise<Result<ScheduledTask[]>> => {
    try {
      return { ok: true, data: await listScheduledTasks() }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'scheduled:create',
    async (_event, input: ScheduledTaskInput): Promise<Result<ScheduledTask>> => {
      try {
        return { ok: true, data: await createScheduledTask(input) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'scheduled:update',
    async (
      _event,
      id: string,
      patch: Partial<ScheduledTaskInput> & { enabled?: boolean }
    ): Promise<Result<ScheduledTask | null>> => {
      try {
        return { ok: true, data: await updateScheduledTask(String(id ?? ''), patch ?? {}) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'scheduled:delete',
    async (_event, id: string): Promise<Result<boolean>> => {
      try {
        return { ok: true, data: await deleteScheduledTask(String(id ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'scheduled:runNow',
    async (_event, id: string): Promise<Result<ScheduledTask | null>> => {
      try {
        return { ok: true, data: await runScheduledTaskNow(String(id ?? '')) }
      } catch (error) {
        return fail(error)
      }
    }
  )
}
