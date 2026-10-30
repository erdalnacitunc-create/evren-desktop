import { contextBridge, ipcRenderer } from 'electron'

/**
 * Renderer'a acilan dar ve tip guvenli API yuzeyi.
 * API anahtari renderer'a geri dondurulmez; yalnizca maske ipucu doner.
 */
export const api = {
  platform: process.platform,
  ping: () => ipcRenderer.invoke('app:ping'),
  appWindow: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const listener = (_event: unknown, value: boolean): void => callback(value === true)
      ipcRenderer.on('window:maximized', listener)
      return () => {
        ipcRenderer.removeListener('window:maximized', listener)
      }
    }
  },
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
    chooseDirectory: (title?: string) => ipcRenderer.invoke('app:chooseDirectory', title),
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', title, body),
    logPath: () => ipcRenderer.invoke('app:getLogPath'),
    openLogs: () => ipcRenderer.invoke('app:openLogs')
  },
  subagent: {
    list: (sessionId?: string) => ipcRenderer.invoke('subagent:list', sessionId),
    cancel: (taskId: string) => ipcRenderer.invoke('subagent:cancel', taskId),
    retry: (taskId: string) => ipcRenderer.invoke('subagent:retry', taskId)
  },
  scheduled: {
    list: () => ipcRenderer.invoke('scheduled:list'),
    create: (input: unknown) => ipcRenderer.invoke('scheduled:create', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('scheduled:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('scheduled:delete', id),
    runNow: (id: string) => ipcRenderer.invoke('scheduled:runNow', id)
  },
  key: {
    status: () => ipcRenderer.invoke('key:status'),
    validate: (key: string) => ipcRenderer.invoke('key:validate', key),
    save: (key: string) => ipcRenderer.invoke('key:save', key),
    clear: () => ipcRenderer.invoke('key:clear')
  },
  models: {
    list: () => ipcRenderer.invoke('models:list')
  },
  audio: {
    transcribe: (payload: unknown) => ipcRenderer.invoke('audio:transcribe', payload)
  },
  quota: {
    get: () => ipcRenderer.invoke('quota:get')
  },
  chat: {
    start: (payload: unknown) => ipcRenderer.invoke('chat:start', payload),
    abort: (requestId: string) => ipcRenderer.invoke('chat:abort', requestId),
    steer: (requestId: string, text: string) =>
      ipcRenderer.invoke('chat:steer', requestId, text),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, data: unknown): void => callback(data)
      ipcRenderer.on('chat:event', listener)
      return () => {
        ipcRenderer.removeListener('chat:event', listener)
      }
    }
  },
  agent: {
    approve: (
      requestId: string,
      toolCallId: string,
      approved: boolean,
      always?: boolean,
      category?: string
    ) => ipcRenderer.invoke('agent:approve', requestId, toolCallId, approved, always, category),
    answerQuestion: (requestId: string, questionId: string, answers: string[]) =>
      ipcRenderer.invoke('agent:answerQuestion', requestId, questionId, answers)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setBaseUrl: (url: string) => ipcRenderer.invoke('settings:setBaseUrl', url),
    update: (patch: unknown) => ipcRenderer.invoke('settings:update', patch)
  },
  headless: {
    status: () => ipcRenderer.invoke('headless:status'),
    configure: (enabled: boolean, port: number) =>
      ipcRenderer.invoke('headless:configure', enabled, port),
    regenerateToken: () => ipcRenderer.invoke('headless:regenerateToken')
  },
  terminal: {
    status: () => ipcRenderer.invoke('terminal:status'),
    start: (cwd?: string) => ipcRenderer.invoke('terminal:start', cwd),
    stop: () => ipcRenderer.invoke('terminal:stop'),
    interrupt: () => ipcRenderer.invoke('terminal:interrupt'),
    write: (data: string) => ipcRenderer.invoke('terminal:write', data),
    runCode: (language: string, code: string) =>
      ipcRenderer.invoke('terminal:runCode', language, code),
    onData: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown): void => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown): void => callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    }
  },
  updater: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: unknown, status: unknown): void => callback(status)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    }
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    search: (query: string) => ipcRenderer.invoke('sessions:search', query),
    get: (id: string) => ipcRenderer.invoke('sessions:get', id),
    create: (modelId: string) => ipcRenderer.invoke('sessions:create', modelId),
    append: (sessionId: string, message: unknown) =>
      ipcRenderer.invoke('sessions:append', sessionId, message),
    rename: (sessionId: string, title: string) =>
      ipcRenderer.invoke('sessions:rename', sessionId, title),
    delete: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),
    setModel: (sessionId: string, modelId: string) =>
      ipcRenderer.invoke('sessions:setModel', sessionId, modelId),
    setWorkspace: (sessionId: string, path: string | null, temporary: boolean) =>
      ipcRenderer.invoke('sessions:setWorkspace', sessionId, path, temporary),
    activateWorkspace: (sessionId: string) =>
      ipcRenderer.invoke('sessions:activateWorkspace', sessionId),
    setTodos: (sessionId: string, todos: unknown) =>
      ipcRenderer.invoke('sessions:setTodos', sessionId, todos)
  },
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    inspect: (url: string) => ipcRenderer.invoke('extensions:inspect', url),
    install: (url: string, unitIds: string[], overrides?: unknown) =>
      ipcRenderer.invoke('extensions:install', url, unitIds, overrides),
    remove: (id: string) => ipcRenderer.invoke('extensions:remove', id),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('extensions:setEnabled', id, enabled),
    updateConfig: (id: string, config: unknown) =>
      ipcRenderer.invoke('extensions:updateConfig', id, config)
  },
  github: {
    tokenStatus: () => ipcRenderer.invoke('github:tokenStatus'),
    setToken: (token: string) => ipcRenderer.invoke('github:setToken', token),
    clearToken: () => ipcRenderer.invoke('github:clearToken'),
    account: () => ipcRenderer.invoke('github:account'),
    connect: (token: string) => ipcRenderer.invoke('github:connect', token),
    disconnect: () => ipcRenderer.invoke('github:disconnect'),
    repos: () => ipcRenderer.invoke('github:repos'),
    deviceStart: (clientId: string) => ipcRenderer.invoke('github:deviceStart', clientId),
    devicePoll: (clientId: string, deviceCode: string) =>
      ipcRenderer.invoke('github:devicePoll', clientId, deviceCode)
  },
  githubApp: {
    status: () => ipcRenderer.invoke('githubApp:status'),
    saveCredentials: (appId: string, privateKey: string) =>
      ipcRenderer.invoke('githubApp:saveCredentials', appId, privateKey),
    installations: () => ipcRenderer.invoke('githubApp:installations'),
    connect: (installationId: number) =>
      ipcRenderer.invoke('githubApp:connect', installationId),
    refresh: () => ipcRenderer.invoke('githubApp:refresh'),
    disconnect: () => ipcRenderer.invoke('githubApp:disconnect')
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status'),
    connect: (id: string) => ipcRenderer.invoke('mcp:connect', id),
    disconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
    logout: (id: string) => ipcRenderer.invoke('mcp:logout', id),
    resources: () => ipcRenderer.invoke('mcp:resources'),
    tools: () => ipcRenderer.invoke('mcp:tools'),
    callTool: (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      taskMode?: boolean
    ) => ipcRenderer.invoke('mcp:callTool', serverId, toolName, args, taskMode),
    readResource: (serverId: string, uri: string) =>
      ipcRenderer.invoke('mcp:readResource', serverId, uri),
    prompts: () => ipcRenderer.invoke('mcp:prompts'),
    getPrompt: (serverId: string, name: string, args: Record<string, string>) =>
      ipcRenderer.invoke('mcp:getPrompt', serverId, name, args),
    tasks: () => ipcRenderer.invoke('mcp:tasks'),
    cancelTask: (serverId: string, taskId: string) =>
      ipcRenderer.invoke('mcp:cancelTask', serverId, taskId),
    taskResult: (serverId: string, taskId: string) =>
      ipcRenderer.invoke('mcp:taskResult', serverId, taskId),
    respondElicitation: (
      id: string,
      action: string,
      content?: Record<string, unknown>
    ) => ipcRenderer.invoke('mcp:elicitResponse', id, action, content),
    onElicitation: (callback: (request: unknown) => void) => {
      const listener = (_event: unknown, request: unknown): void => callback(request)
      ipcRenderer.on('mcp:elicitation', listener)
      return () => ipcRenderer.removeListener('mcp:elicitation', listener)
    }
  },
  plugins: {
    status: () => ipcRenderer.invoke('plugins:status'),
    load: (id: string) => ipcRenderer.invoke('plugins:load', id),
    unload: (id: string) => ipcRenderer.invoke('plugins:unload', id)
  },
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
    skill: (id: string) => ipcRenderer.invoke('skills:get', id)
  },
  compaction: {
    run: (sessionId: string, focus?: string) =>
      ipcRenderer.invoke('compaction:run', sessionId, focus)
  },
  memory: {
    list: (query?: string) => ipcRenderer.invoke('memory:list', query),
    add: (input: unknown) => ipcRenderer.invoke('memory:add', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('memory:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    deleteMatching: (query: string) => ipcRenderer.invoke('memory:deleteMatching', query),
    clear: () => ipcRenderer.invoke('memory:clear'),
    getInstructions: () => ipcRenderer.invoke('memory:getInstructions'),
    setInstructions: (text: string) => ipcRenderer.invoke('memory:setInstructions', text),
    getSettings: () => ipcRenderer.invoke('memory:getSettings'),
    updateSettings: (patch: unknown) => ipcRenderer.invoke('memory:updateSettings', patch),
    learn: (sessionId: string) => ipcRenderer.invoke('memory:learn', sessionId)
  },
  artifacts: {
    save: (name: string, content: string) =>
      ipcRenderer.invoke('artifacts:save', name, content)
  },
  workspace: {
    get: () => ipcRenderer.invoke('workspace:get'),
    choose: () => ipcRenderer.invoke('workspace:choose'),
    createTemp: () => ipcRenderer.invoke('workspace:createTemp'),
    deleteTemp: (path: string) => ipcRenderer.invoke('workspace:deleteTemp', path),
    set: (path: string) => ipcRenderer.invoke('workspace:set', path),
    clear: () => ipcRenderer.invoke('workspace:clear'),
    tree: () => ipcRenderer.invoke('workspace:tree'),
    read: (path: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke('workspace:read', path, offset, limit),
    changes: (limit?: number) => ipcRenderer.invoke('workspace:changes', limit),
    checkpoints: (limit?: number) => ipcRenderer.invoke('workspace:checkpoints', limit),
    restoreCheckpoint: (id: string) => ipcRenderer.invoke('workspace:restoreCheckpoint', id),
    undo: (id?: string) => ipcRenderer.invoke('workspace:undo', id),
    checks: () => ipcRenderer.invoke('workspace:checks'),
    runChecks: (names?: string[]) => ipcRenderer.invoke('workspace:runChecks', names),
    repoMap: (query?: string, maxFiles?: number) =>
      ipcRenderer.invoke('workspace:repoMap', query, maxFiles),
    open: () => ipcRenderer.invoke('workspace:open')
  },
  codeIndex: {
    status: () => ipcRenderer.invoke('codeIndex:status'),
    build: () => ipcRenderer.invoke('codeIndex:build'),
    search: (query: string, topK?: number) =>
      ipcRenderer.invoke('codeIndex:search', query, topK)
  },
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    diff: (path?: string, staged?: boolean) => ipcRenderer.invoke('git:diff', path, staged),
    stage: (paths?: string[]) => ipcRenderer.invoke('git:stage', paths),
    unstage: (paths?: string[]) => ipcRenderer.invoke('git:unstage', paths),
    commit: (message: string) => ipcRenderer.invoke('git:commit', message),
    branches: () => ipcRenderer.invoke('git:branches'),
    worktrees: () => ipcRenderer.invoke('git:worktrees'),
    worktreeAdd: (branch: string) => ipcRenderer.invoke('git:worktreeAdd', branch),
    worktreeRemove: (path: string) => ipcRenderer.invoke('git:worktreeRemove', path),
    remotes: () => ipcRenderer.invoke('git:remotes'),
    push: (remote?: string) => ipcRenderer.invoke('git:push', remote),
    ghStatus: () => ipcRenderer.invoke('git:ghStatus'),
    prStatus: () => ipcRenderer.invoke('git:prStatus'),
    prCreate: (title: string, body?: string) => ipcRenderer.invoke('git:prCreate', title, body)
  }
}

export type EvrenApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('evren', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // contextIsolation kapaliysa (olmamali)
  ;(globalThis as unknown as { evren: EvrenApi }).evren = api
}
