import type {
  AppSettings,
  ChatEvent,
  ChatRequest,
  CompactionResult,
  HeadlessStatus,
  InstalledExtension,
  KeyStatus,
  McpElicitationRequest,
  McpPromptInfo,
  McpPromptResult,
  McpResourceContent,
  McpResourceInfo,
  McpServerStatus,
  McpTaskInfo,
  McpToolInfo,
  MemoryEntry,
  MemorySettings,
  MemoryType,
  ModelInfo,
  PluginStatus,
  QuotaStatus,
  RepoInspection,
  Result,
  Session,
  SessionSummary,
  SlashCommand,
  StoredMessage,
  TerminalStatus,
  UpdateStatus,
  WorkspaceChange,
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceInfo,
  WorkspaceUndoResult
} from '@shared/types'

/**
 * window.evren (preload) uzerine tip guvenli ince katman.
 * Renderer API anahtarini asla geri okumaz.
 */
export const api = {
  platform: window.evren.platform,
  appWindow: {
    minimize: (): Promise<Result<true>> => window.evren.appWindow.minimize(),
    toggleMaximize: (): Promise<Result<boolean>> => window.evren.appWindow.toggleMaximize(),
    isMaximized: (): Promise<Result<boolean>> => window.evren.appWindow.isMaximized(),
    close: (): Promise<Result<true>> => window.evren.appWindow.close(),
    onMaximized: (callback: (maximized: boolean) => void): (() => void) =>
      window.evren.appWindow.onMaximized(callback)
  },
  app: {
    openExternal: (url: string): Promise<Result<boolean>> => window.evren.app.openExternal(url),
    openPath: (path: string): Promise<Result<true>> => window.evren.app.openPath(path),
    notify: (title: string, body: string): Promise<Result<boolean>> =>
      window.evren.app.notify(title, body)
  },
  subagent: {
    list: (
      sessionId?: string
    ): Promise<Result<import('@shared/types').SubagentTaskInfo[]>> =>
      window.evren.subagent.list(sessionId),
    cancel: (
      taskId: string
    ): Promise<
      Result<{ cancelled: boolean; task: import('@shared/types').SubagentTaskInfo | null }>
    > => window.evren.subagent.cancel(taskId),
    retry: (
      taskId: string
    ): Promise<Result<import('@shared/types').SubagentTaskInfo | null>> =>
      window.evren.subagent.retry(taskId)
  },
  scheduled: {
    list: (): Promise<Result<import('@shared/types').ScheduledTask[]>> =>
      window.evren.scheduled.list(),
    create: (
      input: import('@shared/types').ScheduledTaskInput
    ): Promise<Result<import('@shared/types').ScheduledTask>> =>
      window.evren.scheduled.create(input),
    update: (
      id: string,
      patch: Partial<import('@shared/types').ScheduledTaskInput> & { enabled?: boolean }
    ): Promise<Result<import('@shared/types').ScheduledTask | null>> =>
      window.evren.scheduled.update(id, patch),
    delete: (id: string): Promise<Result<boolean>> => window.evren.scheduled.delete(id),
    runNow: (
      id: string
    ): Promise<Result<import('@shared/types').ScheduledTask | null>> =>
      window.evren.scheduled.runNow(id)
  },
  key: {
    status: (): Promise<Result<KeyStatus>> => window.evren.key.status(),
    validate: (key: string): Promise<Result<ModelInfo[]>> => window.evren.key.validate(key),
    save: (key: string): Promise<Result<{ hint: string }>> => window.evren.key.save(key),
    clear: (): Promise<Result<true>> => window.evren.key.clear()
  },
  models: {
    list: (): Promise<Result<ModelInfo[]>> => window.evren.models.list()
  },
  audio: {
    transcribe: (payload: {
      data: ArrayBuffer
      mimeType: string
      filename?: string
      language?: string
      model?: string
    }): Promise<Result<{ text: string; model: string }>> =>
      window.evren.audio.transcribe(payload)
  },
  quota: {
    get: (): Promise<Result<QuotaStatus>> => window.evren.quota.get()
  },
  chat: {
    start: (payload: ChatRequest): Promise<Result<{ requestId: string }>> =>
      window.evren.chat.start(payload),
    abort: (requestId: string): Promise<Result<boolean>> => window.evren.chat.abort(requestId),
    onEvent: (callback: (event: ChatEvent) => void): (() => void) =>
      window.evren.chat.onEvent(callback as (event: unknown) => void)
  },
  agent: {
    approve: (
      requestId: string,
      toolCallId: string,
      approved: boolean,
      always?: boolean,
      category?: string
    ): Promise<Result<boolean>> =>
      window.evren.agent.approve(requestId, toolCallId, approved, always, category)
  },
  settings: {
    get: (): Promise<Result<AppSettings>> => window.evren.settings.get(),
    setBaseUrl: (url: string): Promise<Result<AppSettings>> => window.evren.settings.setBaseUrl(url),
    update: (patch: Partial<AppSettings>): Promise<Result<AppSettings>> =>
      window.evren.settings.update(patch)
  },
  headless: {
    status: (): Promise<Result<HeadlessStatus>> => window.evren.headless.status(),
    configure: (enabled: boolean, port: number): Promise<Result<HeadlessStatus>> =>
      window.evren.headless.configure(enabled, port),
    regenerateToken: (): Promise<Result<HeadlessStatus>> =>
      window.evren.headless.regenerateToken()
  },
  terminal: {
    status: (): Promise<Result<TerminalStatus>> => window.evren.terminal.status(),
    start: (cwd?: string): Promise<Result<TerminalStatus>> => window.evren.terminal.start(cwd),
    stop: (): Promise<Result<true>> => window.evren.terminal.stop(),
    interrupt: (): Promise<Result<true>> => window.evren.terminal.interrupt(),
    write: (data: string): Promise<Result<boolean>> => window.evren.terminal.write(data),
    runCode: (
      language: string,
      code: string
    ): Promise<Result<{ ok: boolean; command?: string; label?: string; error?: string }>> =>
      window.evren.terminal.runCode(language, code),
    onData: (callback: (payload: { data: string }) => void): (() => void) =>
      window.evren.terminal.onData(callback as (payload: unknown) => void),
    onExit: (
      callback: (payload: { code: number | null; signal: string | null }) => void
    ): (() => void) =>
      window.evren.terminal.onExit(callback as (payload: unknown) => void)
  },
  updater: {
    status: (): Promise<Result<UpdateStatus>> => window.evren.updater.status(),
    check: (): Promise<Result<UpdateStatus>> => window.evren.updater.check(),
    download: (): Promise<Result<UpdateStatus>> => window.evren.updater.download(),
    install: (): Promise<Result<true>> => window.evren.updater.install(),
    onStatus: (callback: (status: UpdateStatus) => void): (() => void) =>
      window.evren.updater.onStatus(callback as (status: unknown) => void)
  },
  sessions: {
    list: (): Promise<Result<SessionSummary[]>> => window.evren.sessions.list(),
    search: (query: string): Promise<Result<SessionSummary[]>> =>
      window.evren.sessions.search(query),
    get: (id: string): Promise<Result<Session | null>> => window.evren.sessions.get(id),
    create: (modelId: string): Promise<Result<Session>> => window.evren.sessions.create(modelId),
    append: (sessionId: string, message: StoredMessage): Promise<Result<Session | null>> =>
      window.evren.sessions.append(sessionId, message),
    rename: (sessionId: string, title: string): Promise<Result<Session | null>> =>
      window.evren.sessions.rename(sessionId, title),
    delete: (sessionId: string): Promise<Result<boolean>> => window.evren.sessions.delete(sessionId),
    setModel: (sessionId: string, modelId: string): Promise<Result<Session | null>> =>
      window.evren.sessions.setModel(sessionId, modelId),
    setTodos: (sessionId: string, todos: import('@shared/types').TodoItem[]): Promise<Result<Session | null>> =>
      window.evren.sessions.setTodos(sessionId, todos)
  },
  extensions: {
    list: (): Promise<Result<InstalledExtension[]>> => window.evren.extensions.list(),
    inspect: (url: string): Promise<Result<RepoInspection>> => window.evren.extensions.inspect(url),
    install: (
      url: string,
      unitIds: string[],
      overrides?: Record<string, { command?: string; args?: string[] }>
    ): Promise<Result<InstalledExtension[]>> =>
      window.evren.extensions.install(url, unitIds, overrides),
    remove: (id: string): Promise<Result<boolean>> => window.evren.extensions.remove(id),
    setEnabled: (id: string, enabled: boolean): Promise<Result<boolean>> =>
      window.evren.extensions.setEnabled(id, enabled),
    updateConfig: (
      id: string,
      config: InstalledExtension['config']
    ): Promise<Result<InstalledExtension | null>> =>
      window.evren.extensions.updateConfig(id, config)
  },
  github: {
    tokenStatus: (): Promise<Result<{ hasToken: boolean; hint: string | null }>> =>
      window.evren.github.tokenStatus(),
    setToken: (token: string): Promise<Result<true>> => window.evren.github.setToken(token),
    clearToken: (): Promise<Result<true>> => window.evren.github.clearToken(),
    account: (): Promise<Result<import('@shared/types').GithubAccount>> =>
      window.evren.github.account(),
    connect: (token: string): Promise<Result<import('@shared/types').GithubAccount>> =>
      window.evren.github.connect(token),
    disconnect: (): Promise<Result<true>> => window.evren.github.disconnect(),
    repos: (): Promise<Result<import('@shared/types').GithubRepo[]>> =>
      window.evren.github.repos(),
    deviceStart: (
      clientId: string
    ): Promise<Result<import('@shared/types').GithubDeviceCode>> =>
      window.evren.github.deviceStart(clientId),
    devicePoll: (
      clientId: string,
      deviceCode: string
    ): Promise<Result<import('@shared/types').GithubDevicePoll>> =>
      window.evren.github.devicePoll(clientId, deviceCode)
  },
  githubApp: {
    status: (): Promise<Result<import('@shared/types').GithubAppStatus>> =>
      window.evren.githubApp.status(),
    saveCredentials: (
      appId: string,
      privateKey: string
    ): Promise<Result<import('@shared/types').GithubAppStatus>> =>
      window.evren.githubApp.saveCredentials(appId, privateKey),
    installations: (): Promise<Result<import('@shared/types').GithubAppInstallation[]>> =>
      window.evren.githubApp.installations(),
    connect: (installationId: number): Promise<Result<import('@shared/types').GithubAppStatus>> =>
      window.evren.githubApp.connect(installationId),
    refresh: (): Promise<Result<import('@shared/types').GithubAppStatus>> =>
      window.evren.githubApp.refresh(),
    disconnect: (): Promise<Result<import('@shared/types').GithubAppStatus>> =>
      window.evren.githubApp.disconnect()
  },
  mcp: {
    status: (): Promise<Result<McpServerStatus[]>> => window.evren.mcp.status(),
    connect: (id: string): Promise<Result<McpServerStatus>> => window.evren.mcp.connect(id),
    disconnect: (id: string): Promise<Result<true>> => window.evren.mcp.disconnect(id),
    logout: (id: string): Promise<Result<true>> => window.evren.mcp.logout(id),
    resources: (): Promise<Result<McpResourceInfo[]>> => window.evren.mcp.resources(),
    tools: (): Promise<Result<McpToolInfo[]>> => window.evren.mcp.tools(),
    callTool: (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      taskMode?: boolean
    ): Promise<Result<{ ok: boolean; content: string; task?: McpTaskInfo }>> =>
      window.evren.mcp.callTool(serverId, toolName, args, taskMode),
    readResource: (serverId: string, uri: string): Promise<Result<McpResourceContent[]>> =>
      window.evren.mcp.readResource(serverId, uri),
    prompts: (): Promise<Result<McpPromptInfo[]>> => window.evren.mcp.prompts(),
    getPrompt: (
      serverId: string,
      name: string,
      args: Record<string, string>
    ): Promise<Result<McpPromptResult>> => window.evren.mcp.getPrompt(serverId, name, args),
    tasks: (): Promise<Result<McpTaskInfo[]>> => window.evren.mcp.tasks(),
    cancelTask: (serverId: string, taskId: string): Promise<Result<McpTaskInfo | null>> =>
      window.evren.mcp.cancelTask(serverId, taskId),
    taskResult: (
      serverId: string,
      taskId: string
    ): Promise<Result<{ ok: boolean; content: string }>> =>
      window.evren.mcp.taskResult(serverId, taskId),
    respondElicitation: (
      id: string,
      action: 'accept' | 'decline' | 'cancel',
      content?: Record<string, unknown>
    ): Promise<Result<true>> => window.evren.mcp.respondElicitation(id, action, content),
    onElicitation: (callback: (request: McpElicitationRequest) => void): (() => void) =>
      window.evren.mcp.onElicitation(callback as (request: unknown) => void)
  },
  plugins: {
    status: (): Promise<Result<PluginStatus[]>> => window.evren.plugins.status(),
    load: (id: string): Promise<Result<PluginStatus>> => window.evren.plugins.load(id),
    unload: (id: string): Promise<Result<true>> => window.evren.plugins.unload(id)
  },
  commands: {
    list: (): Promise<Result<SlashCommand[]>> => window.evren.commands.list(),
    skill: (id: string): Promise<Result<{ id: string; name: string; content: string } | null>> =>
      window.evren.commands.skill(id)
  },
  compaction: {
    run: (sessionId: string, focus?: string): Promise<Result<CompactionResult>> =>
      window.evren.compaction.run(sessionId, focus)
  },
  memory: {
    list: (query?: string): Promise<Result<MemoryEntry[]>> => window.evren.memory.list(query),
    add: (input: {
      type: MemoryType
      text: string
      tags?: string[]
      sourceSessionId?: string
      pinned?: boolean
      embedding?: number[]
    }): Promise<Result<MemoryEntry>> => window.evren.memory.add(input),
    update: (id: string, patch: unknown): Promise<Result<MemoryEntry | null>> =>
      window.evren.memory.update(id, patch),
    delete: (id: string): Promise<Result<boolean>> => window.evren.memory.delete(id),
    deleteMatching: (query: string): Promise<Result<number>> =>
      window.evren.memory.deleteMatching(query),
    clear: (): Promise<Result<true>> => window.evren.memory.clear(),
    getInstructions: (): Promise<Result<string>> => window.evren.memory.getInstructions(),
    setInstructions: (text: string): Promise<Result<true>> =>
      window.evren.memory.setInstructions(text),
    getSettings: (): Promise<Result<MemorySettings>> => window.evren.memory.getSettings(),
    updateSettings: (patch: Partial<MemorySettings>): Promise<Result<MemorySettings>> =>
      window.evren.memory.updateSettings(patch),
    learn: (sessionId: string): Promise<Result<{ added: number; skipped?: string }>> =>
      window.evren.memory.learn(sessionId)
  },
  artifacts: {
    save: (name: string, content: string): Promise<Result<string | null>> =>
      window.evren.artifacts.save(name, content)
  },
  workspace: {
    get: (): Promise<Result<WorkspaceInfo>> => window.evren.workspace.get(),
    choose: (): Promise<Result<WorkspaceInfo>> => window.evren.workspace.choose(),
    set: (path: string): Promise<Result<WorkspaceInfo>> => window.evren.workspace.set(path),
    clear: (): Promise<Result<WorkspaceInfo>> => window.evren.workspace.clear(),
    tree: (): Promise<Result<WorkspaceEntry[]>> => window.evren.workspace.tree(),
    read: (
      path: string,
      offset?: number,
      limit?: number
    ): Promise<Result<WorkspaceFileContent>> =>
      window.evren.workspace.read(path, offset, limit),
    changes: (limit?: number): Promise<Result<WorkspaceChange[]>> =>
      window.evren.workspace.changes(limit),
    checkpoints: (limit?: number): Promise<Result<import('@shared/types').WorkspaceCheckpoint[]>> =>
      window.evren.workspace.checkpoints(limit),
    restoreCheckpoint: (id: string): Promise<Result<import('@shared/types').WorkspaceRestoreResult>> =>
      window.evren.workspace.restoreCheckpoint(id),
    undo: (id?: string): Promise<Result<WorkspaceUndoResult>> => window.evren.workspace.undo(id),
    checks: (): Promise<Result<import('@shared/types').ProjectCheck[]>> =>
      window.evren.workspace.checks(),
    runChecks: (names?: string[]): Promise<Result<import('@shared/types').CheckResult[]>> =>
      window.evren.workspace.runChecks(names),
    repoMap: (
      query?: string,
      maxFiles?: number
    ): Promise<Result<import('@shared/types').RepoMapResult>> =>
      window.evren.workspace.repoMap(query, maxFiles),
    open: (): Promise<Result<boolean>> => window.evren.workspace.open()
  },
  codeIndex: {
    status: (): Promise<Result<import('@shared/types').CodeIndexStatus>> =>
      window.evren.codeIndex.status(),
    build: (): Promise<Result<import('@shared/types').CodeIndexStatus>> =>
      window.evren.codeIndex.build(),
    search: (
      query: string,
      topK?: number
    ): Promise<Result<import('@shared/types').CodeSearchResult[]>> =>
      window.evren.codeIndex.search(query, topK)
  },
  git: {
    status: (): Promise<Result<import('@shared/types').GitStatus>> => window.evren.git.status(),
    diff: (path?: string, staged?: boolean): Promise<Result<string>> =>
      window.evren.git.diff(path, staged),
    stage: (paths?: string[]): Promise<Result<import('@shared/types').GitCommandResult>> =>
      window.evren.git.stage(paths),
    unstage: (paths?: string[]): Promise<Result<import('@shared/types').GitCommandResult>> =>
      window.evren.git.unstage(paths),
    commit: (message: string): Promise<Result<import('@shared/types').GitCommandResult>> =>
      window.evren.git.commit(message),
    branches: (): Promise<Result<string[]>> => window.evren.git.branches(),
    worktrees: (): Promise<Result<import('@shared/types').GitWorktree[]>> =>
      window.evren.git.worktrees(),
    worktreeAdd: (
      branch: string
    ): Promise<Result<import('@shared/types').GitWorktreeAddResult>> =>
      window.evren.git.worktreeAdd(branch),
    worktreeRemove: (
      path: string
    ): Promise<Result<import('@shared/types').GitCommandResult>> =>
      window.evren.git.worktreeRemove(path),
    remotes: (): Promise<Result<import('@shared/types').GitRemote[]>> =>
      window.evren.git.remotes(),
    push: (remote?: string): Promise<Result<import('@shared/types').GitPushResult>> =>
      window.evren.git.push(remote),
    ghStatus: (): Promise<Result<import('@shared/types').GitGhStatus>> =>
      window.evren.git.ghStatus(),
    prStatus: (): Promise<Result<import('@shared/types').GitPrStatus>> =>
      window.evren.git.prStatus(),
    prCreate: (
      title: string,
      body?: string
    ): Promise<Result<import('@shared/types').GitCommandResult>> =>
      window.evren.git.prCreate(title, body)
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('tr-TR').format(value)
}

export function formatContext(tokens: number | null | undefined): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}
