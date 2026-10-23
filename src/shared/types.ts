/**
 * Ana surec ile renderer arasinda paylasilan tipler.
 * Gercek kaynak: docs/evren-llmapi-openapi.json
 */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number }

export interface ModelPricing {
  prompt_token_price: number
  completion_token_price: number
  currency: string
  free_until: string | null
}

export interface ModelCapabilities {
  tools: boolean
  thinking: boolean
  reasoning_effort: boolean
  reasoning_effort_values: string[] | null
  reasoning_effort_aliases: Record<string, string> | null
  vision: boolean
  response_format: boolean
  seed: boolean
  top_k: boolean
  stop: boolean
}

export interface ModelInfo {
  id: string
  object?: string
  created: number
  owned_by?: string
  task: string
  modalities?: string[]
  pricing?: ModelPricing | null
  context_length?: number | null
  default_max_output_tokens?: number | null
  capabilities?: ModelCapabilities | null
  precision?: string | null
}

export interface QuotaStatus {
  used_tokens: number | null
  cap: number | null
  window_minutes: number | null
  reset_at: string | null
  usage_ratio: number | null
  level: 'ok' | 'warn' | 'critical' | 'unknown'
  held_cr: string
  remaining_cr: string
  daily_used_tokens: number | null
  daily_limit_tokens: number | null
  daily_remaining_tokens: number | null
  daily_reset_at: string | null
}

export interface KeyStatus {
  hasKey: boolean
  hint: string | null
  source: 'stored' | 'env' | null
  encryptionAvailable: boolean
}

export interface ChatDefaults {
  temperature?: number
  top_p?: number
  max_tokens?: number
  reasoning_effort?: string
  thinking?: boolean
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryEntry {
  id: string
  type: MemoryType
  text: string
  tags?: string[]
  sourceSessionId?: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  pinned: boolean
  embedding?: number[]
}

export interface MemorySettings {
  autoMemory: boolean
  extractionModel: 'session' | string
  retrievalTopK: number
  retrievalTokenBudget: number
  maxMemories: number
}

export interface CompactionSettings {
  auto: boolean
  thresholdPercent: number
  keepTokens: number
  bufferPercent: number
}

export interface HookSettings {
  formatOnEdit: boolean
  preCommitChecks: boolean
}

export interface SlashCommand {
  id: string
  name: string
  description?: string
  category: string
  source: 'builtin' | 'custom' | 'skill'
  acceptsArguments?: boolean
  argumentHint?: string
  template?: string
  skillId?: string
  model?: string
  agent?: string
}

export interface CompactionResult {
  compacted: boolean
  reason?: string
  summary?: string
  summaryMessageCount?: number
  compactedAt?: number
  removedTokens?: number
  keptTokens?: number
}

export interface HeadlessSettings {
  enabled: boolean
  port: number
}

export interface HeadlessStatus {
  running: boolean
  host: string
  port: number
  baseUrl: string
  token: string | null
  requestCount: number
  lastRequestAt: number | null
  error?: string
}

export interface TerminalStatus {
  running: boolean
  cwd: string | null
  shell: string | null
  error?: string
}

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  version?: string
  releaseNotes?: string
  percent?: number
  error?: string
  canCheck: boolean
}

export interface ReferenceDirectory {
  name: string
  path: string
}

export interface AppSettings extends ChatDefaults {
  baseUrl: string
  theme?: ThemeMode
  agentMode?: AgentMode
  browserTools?: boolean
  computerTools?: boolean
  workspacePath?: string | null
  workspaceTools?: boolean
  references?: ReferenceDirectory[]
  githubOAuthClientId?: string
  permissions?: PermissionSettings
  hooks?: HookSettings
  memory?: MemorySettings
  compaction?: CompactionSettings
  headless?: HeadlessSettings
  subagents?: SubagentSettings
  githubApp?: GithubAppSettings
}

/** task -> gorunen ad */
export const TASK_LABELS: Record<string, string> = {
  chat: 'Sohbet',
  vision_chat: 'Görsel sohbet',
  embedding: 'Gömme (embedding)',
  rerank: 'Yeniden sıralama',
  ocr: 'OCR',
  audio_transcription: 'Ses -> metin',
  guard: 'Koruma (guard)',
  decision: 'Karar'
}

/* ---------------- Sohbet / streaming ---------------- */

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
}

export interface ToolCallPayload {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatContentPart[]
  tool_call_id?: string
  tool_calls?: ToolCallPayload[]
}

export type AgentMode = 'confirm' | 'auto'
export type AgentProfile = 'build' | 'plan'
export type ThemeMode = 'dark' | 'light' | 'system'
export type SubagentType = 'explore' | 'review' | 'general'
export type SubagentTaskStatus = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'

export interface SubagentTaskInfo {
  id: string
  requestId: string
  sessionId?: string
  agentType: SubagentType
  prompt: string
  model?: string
  workspaceRoot?: string | null
  status: SubagentTaskStatus
  createdAt: number
  finishedAt?: number
  attempts?: number
  lastAttemptAt?: number
  result?: string
  error?: string
}

export interface SubagentSettings {
  autoResume: boolean
}

export interface GithubAppSettings {
  appId: string
  installationId?: number
  accountLogin?: string
  repositorySelection?: string
}

export type PermissionAction = 'allow' | 'ask' | 'deny'
export type PermissionCategory = 'read' | 'edit' | 'execute' | 'browser' | 'mcp' | 'computer'

export interface PermissionSettings {
  read?: PermissionAction
  edit?: PermissionAction
  execute?: PermissionAction
  browser?: PermissionAction
  mcp?: PermissionAction
  computer?: PermissionAction
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface AgentOptions {
  enabled: boolean
  mode: AgentMode
  profile: AgentProfile
  browser: boolean
  computer: boolean
  workspace: boolean
}

export interface ToolResultInfo {
  toolCallId: string
  name: string
  ok: boolean
  content: string
  imageDataUrl?: string
  checkpointId?: string
  todos?: TodoItem[]
}

export interface AgentApprovalRequest {
  requestId: string
  toolCallId: string
  name: string
  summary: string
  category: PermissionCategory
  args: Record<string, unknown>
}

export interface ChatRequest {
  requestId?: string
  sessionId?: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  reasoning_effort?: string
  thinking?: boolean
  agent?: AgentOptions
  multiverse?: MultiverseOptions
}

export interface MultiverseOptions {
  enabled: boolean
  members: string[]
}

export interface MultiverseMemberResult {
  modelId: string
  ok: boolean
  content?: string
  error?: string
  usage?: ChatUsage
}

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface AgentQuestionOption {
  label: string
  description?: string
}

export interface AgentQuestion {
  id: string
  header: string
  question: string
  options: AgentQuestionOption[]
  multiple: boolean
}

export interface AgentQuestionRequest {
  requestId: string
  question: AgentQuestion
}

export type ChatEvent =
  | { requestId: string; type: 'content'; text: string }
  | { requestId: string; type: 'reasoning'; text: string }
  | { requestId: string; type: 'tool-call'; call: ToolCallInfo }
  | { requestId: string; type: 'tool-result'; result: ToolResultInfo }
  | { requestId: string; type: 'approval'; request: AgentApprovalRequest }
  | { requestId: string; type: 'question'; request: AgentQuestionRequest }
  | { requestId: string; type: 'multiverse-start'; members: string[] }
  | { requestId: string; type: 'multiverse-member'; result: MultiverseMemberResult }
  | { requestId: string; type: 'multiverse-synthesis'; candidateCount: number }
  | { requestId: string; type: 'subagent-task'; task: SubagentTaskInfo }
  | { requestId: string; type: 'usage'; usage: ChatUsage }
  | { requestId: string; type: 'done'; finishReason: string | null }
  | { requestId: string; type: 'error'; error: string; status?: number }

/* ---------------- Oturumlar ---------------- */

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  createdAt: number
  usage?: ChatUsage
  finishReason?: string | null
}

export interface Session {
  id: string
  title: string
  modelId: string
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
  todos?: TodoItem[]
  summary?: string
  summaryMessageCount?: number
  compactedAt?: number
  lastMemoryLearnCount?: number
}

export interface SessionSummary {
  id: string
  title: string
  modelId: string
  createdAt: number
  updatedAt: number
  messageCount: number
  preview: string
}

/* ---------------- Uzantilar ---------------- */

export type ExtensionType = 'mcp' | 'plugin' | 'skill'

export interface ExtensionSource {
  provider: 'github'
  repo: string
  url: string
  ref?: string
  commit?: string
  path?: string
}

export interface InstalledExtension {
  id: string
  type: ExtensionType
  name: string
  description?: string
  version?: string
  license?: string
  enabled: boolean
  scope: 'global'
  source: ExtensionSource
  localPath: string
  installedAt: number
  updatedAt: number
  config?: McpServerConfig
  entry?: string
  permissions?: PluginPermissions
}

export interface McpServerConfig {
  type: 'local' | 'remote'
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface McpServerStatus {
  id: string
  name: string
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  toolCount: number
  resourceCount?: number
  promptCount?: number
  taskCapable?: boolean
  error?: string
}

/* ---------------- MCP kaynakları / promptları / görevleri ---------------- */

export interface McpToolInfo {
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: unknown
  taskCapable: boolean
}

export interface McpResourceInfo {
  serverId: string
  serverName: string
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
  template?: boolean
  uriTemplate?: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  truncated?: boolean
}

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPromptInfo {
  serverId: string
  serverName: string
  name: string
  description?: string
  title?: string
  arguments: McpPromptArgument[]
}

export interface McpPromptMessage {
  role: string
  text: string
}

export interface McpPromptResult {
  description?: string
  messages: McpPromptMessage[]
}

export type McpTaskStatus =
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface McpTaskInfo {
  serverId: string
  serverName: string
  taskId: string
  status: McpTaskStatus | string
  ttl: number | null
  createdAt: string
  lastUpdatedAt: string
  pollInterval?: number
  statusMessage?: string
}

export type McpElicitationAction = 'accept' | 'decline' | 'cancel'

export interface McpElicitationRequest {
  id: string
  serverId: string
  serverName: string
  message: string
  mode: 'form' | 'url'
  url?: string
  schema?: Record<string, unknown>
}

export interface McpElicitationResponse {
  action: McpElicitationAction
  content?: Record<string, unknown>
}

export interface PluginPermissions {
  network?: string[]
  filesystem?: boolean
  shell?: boolean
  secrets?: string[]
}

export interface PluginStatus {
  id: string
  name: string
  state: 'unloaded' | 'loading' | 'loaded' | 'error'
  toolCount: number
  error?: string
}

export interface DetectedUnit {
  type: ExtensionType
  id: string
  name: string
  description?: string
  path: string
  entry?: string
  details?: Record<string, unknown>
}

export interface RepoInspection {
  repo: string
  url: string
  description?: string
  stars?: number
  license?: string
  version?: string
  defaultBranch?: string
  commit: string
  units: DetectedUnit[]
}

/* ---------------- Çalışma alanı ---------------- */

export interface WorkspaceInfo {
  path: string | null
  exists: boolean
  temporary?: boolean
}

export interface WorkspaceEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size?: number
  children?: WorkspaceEntry[]
}

export interface WorkspaceFileContent {
  path: string
  content: string
  size: number
  truncated: boolean
  binary: boolean
}

export interface WorkspaceChange {
  id: string
  path: string
  action: 'write' | 'edit' | 'delete' | 'mkdir'
  at: number
  diff: string
  sessionId?: string
  checkpointId?: string
  existed: boolean
}

export interface WorkspaceCheckpoint {
  id: string
  at: number
  sessionId?: string
  files: string[]
  diff: string
  changes: WorkspaceChange[]
}

export interface WorkspaceUndoResult {
  id: string
  path: string
  restored: boolean
}

export interface WorkspaceRestoreResult {
  id: string
  files: number
  restored: boolean
}

/* ---------------- Proje kontrolleri ---------------- */

export interface ProjectCheck {
  id: string
  label: string
  script: string
  command: string
  available: boolean
}

export interface CheckResult {
  id: string
  label: string
  command: string
  ok: boolean
  exitCode: number
  output: string
}

/* ---------------- Git ---------------- */

export interface GitFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  untracked: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  files: GitFile[]
  clean: boolean
  repoRoot?: string
  upstream?: string | null
  ahead?: number
  behind?: number
}

export interface GitWorktree {
  path: string
  branch: string
  head?: string
  isMain: boolean
}

export interface GitWorktreeAddResult {
  path: string
  branch: string
  output: string
}

export interface GitCommandResult {
  output: string
  ok: boolean
}

export interface GitRemote {
  name: string
  url: string
}

export interface GitPushResult {
  remote: string
  branch: string
  output: string
}

export interface GitGhStatus {
  available: boolean
  authenticated: boolean
  error?: string
  version?: string
}

export interface GitPrCheck {
  name: string
  status: string
  conclusion?: string
  url?: string
}

export interface GitPrInfo {
  number: number
  title: string
  url: string
  state: string
  checks: GitPrCheck[]
}

export interface GitPrStatus {
  available: boolean
  authenticated: boolean
  pr: GitPrInfo | null
  error?: string
}

/* ---------------- Zamanlanmış görevler ---------------- */

export type ScheduleKind = 'once' | 'interval' | 'daily'

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  modelId: string
  kind: ScheduleKind
  runAt?: number
  intervalMinutes?: number
  time?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  nextRunAt?: number
  lastResult?: string
  lastError?: string
}

export interface ScheduledTaskInput {
  name: string
  prompt: string
  modelId: string
  kind: ScheduleKind
  runAt?: number
  intervalMinutes?: number
  time?: string
  enabled?: boolean
}

/* ---------------- GitHub hesabı ---------------- */

export interface GithubUser {
  login: string
  name: string | null
  avatarUrl: string
  htmlUrl: string
  publicRepos: number
  totalPrivateRepos: number
}

export interface GithubAccount {
  connected: boolean
  user?: GithubUser
  scopes?: string[]
  error?: string
}

export interface GithubRepo {
  id: number
  fullName: string
  private: boolean
  htmlUrl: string
  description: string | null
  defaultBranch: string
  updatedAt: string
}

export interface GithubDeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type GithubDevicePoll =
  | { status: 'pending'; interval?: number }
  | { status: 'slow_down'; interval: number }
  | { status: 'success'; account: GithubAccount }
  | { status: 'error'; error: string }

export interface GithubAppInstallation {
  id: number
  accountLogin: string
  accountType: string
  repositorySelection: string
  htmlUrl: string
  appSlug?: string
}

export interface GithubAppStatus {
  configured: boolean
  appId?: string
  installationId?: number
  accountLogin?: string
  repositorySelection?: string
  tokenExpiresAt?: number
  hasKey?: boolean
  error?: string
}

/* ---------------- Repo map ---------------- */

export interface RepoMapResult {
  root: string
  text: string
  fileCount: number
  symbolCount: number
  truncated: boolean
}

/* ---------------- Anlamsal kod indeksi ---------------- */

export interface CodeIndexStatus {
  root: string
  indexed: boolean
  files: number
  chunks: number
  createdAt?: number
  model?: string
}

export interface CodeSearchResult {
  path: string
  startLine: number
  endLine: number
  score: number
  preview: string
}
