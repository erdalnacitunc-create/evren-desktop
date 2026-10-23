import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AgentApprovalRequest,
  AgentOptions,
  AgentProfile,
  AgentQuestionRequest,
  ChatDefaults,
  ChatMessage,
  ChatUsage,
  CompactionSettings,
  ModelInfo,
  SlashCommand,
  SubagentTaskInfo,
  TodoItem,
  ToolCallInfo,
  ToolResultInfo,
  WorkspaceEntry
} from '@shared/types'
import { api, formatNumber } from '../lib/ipc'
import { estimateMultiverse, type MultiverseEstimate } from '../lib/multiverse'
import { estimateMessagesTokens } from '../lib/tokens'
import { extractArtifacts, formatBytes, type Artifact } from '../lib/artifacts'
import { PERMISSION_LABELS } from '@shared/permissions'
import { CommandPalette } from './CommandPalette'
import { ReviewPane } from './ReviewPane'
import { WorkspacePanel } from './WorkspacePanel'
import { TasksPanel } from './TasksPanel'
import { GitPanel } from './GitPanel'
import { TerminalPanel } from './TerminalPanel'

const WORKSPACE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'patch',
  'delete_file',
  'create_directory',
  'run_command',
  'git'
])

interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  intermediate?: boolean
}

type Item =
  | ({ kind: 'message' } & UiMessage)
  | { kind: 'tool'; call: ToolCallInfo; result?: ToolResultInfo }

interface MultiverseConfig {
  enabled: boolean
  members: string[]
  models: ModelInfo[]
}

interface Props {
  model: ModelInfo
  sessionId: string
  defaults: ChatDefaults
  agent: AgentOptions
  multiverse: MultiverseConfig
  commands: SlashCommand[]
  summary?: string
  summaryMessageCount?: number
  compaction: CompactionSettings
  initialMessages: UiMessage[]
  workspacePath: string | null
  initialTodos: TodoItem[]
  onPersistUser: (content: string) => void
  onPersistAssistant: (message: {
    content: string
    reasoning?: string
    usage?: ChatUsage
    finishReason?: string | null
  }) => void
  onQuotaRefresh?: () => void
  onSessionUpdated: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenMemory: () => void
  onOpenExtensions: () => void
  onChooseWorkspace: () => Promise<void>
  onWorkspaceChanged: () => void
  onTodosChange: (todos: TodoItem[]) => void
  onSettingsChanged: () => void
}

interface Draft {
  content: string
  reasoning: string
}

interface PendingAttachment {
  id: string
  name: string
  kind: 'text' | 'image'
  content: string
  dataUrl?: string
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Dosya okunamadı.'))
    reader.readAsDataURL(file)
  })
}

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => nodeText(child)).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props?: { children?: React.ReactNode } }).props?.children)
  }
  return ''
}

function codeLanguage(node: React.ReactNode): string | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = codeLanguage(child)
      if (found) return found
    }
    return null
  }
  const props = (node as { props?: { className?: string; children?: React.ReactNode } }).props
  const className = props?.className ?? ''
  const match = /language-([\w-]+)/.exec(className)
  if (match) return match[1].toLowerCase()
  if (props?.children) return codeLanguage(props.children)
  return null
}

const RUNNABLE_LANGUAGES = new Set([
  'python',
  'py',
  'python3',
  'node',
  'js',
  'javascript',
  'mjs',
  'powershell',
  'ps1',
  'pwsh',
  'bash',
  'sh',
  'shell',
  'zsh'
])

function suggestedRepliesFor(text: string): string[] {
  if (!text.trim()) return []
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[*_>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const replies: string[] = []
  const add = (value: string): void => {
    const reply = value.trim().replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    if (!reply || reply.length > 80 || replies.includes(reply)) return
    replies.push(reply)
  }

  const quoted = [
    /[“"'‘]([^”"'’\n]{1,80})[”"'’]\s*(?:yaz|de|yazın|deyin|yazabilirsin|diyebilirsin|type|reply|respond|say)/gi,
    /(?:yaz|de|type|reply|respond|say)\s*[“"'‘]([^”"'’\n]{1,80})[”"'’]/gi,
    /(?:şunu|şu şekilde|olarak)\s+[“"'‘]([^”"'’\n]{1,80})[”"'’]/gi
  ]
  for (const pattern of quoted) {
    for (const match of cleaned.matchAll(pattern)) {
      if (match[1]) add(match[1])
    }
  }

  if (
    replies.length === 0 &&
    /(onayl|devam edelim|devam edeyim|devam edelim mi|hazır mısın|hazır mıyız|tamam mı|ister misin|onaylıyor musun|evet mi|hayır mı|başlayalım mı|deneyelim mi)/i.test(
      cleaned
    )
  ) {
    add('Evet')
    add('Hayır')
  }
  if (replies.length < 2 && /(devam|başla|deneyelim)/i.test(cleaned) && !replies.includes('Devam')) {
    add('Devam')
  }
  return replies.slice(0, 4)
}

function CodeBlock({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = nodeText(children)
  const language = codeLanguage(children)
  const runnable = !!language && RUNNABLE_LANGUAGES.has(language)
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // pano izni yoksa sessizce gec
    }
  }
  return (
    <div className="code-block">
      {runnable && (
        <button
          className="code-copy code-run"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('evren:run-code', {
                detail: { language, code: text }
              })
            )
          }
          title={`Kodu terminalde çalıştır (${language})`}
        >
          ▶
        </button>
      )}
      <button className="code-copy" onClick={() => void copy()} title="Kodu kopyala">
        {copied ? '✓' : '⧉'}
      </button>
      <pre>{children}</pre>
    </div>
  )
}

interface MvResult {
  modelId: string
  status: 'pending' | 'ok' | 'error'
  content?: string
  error?: string
}

type MvConfirm = MultiverseEstimate & { text: string; members: string[] }

const EMPTY_DRAFT: Draft = { content: '', reasoning: '' }

function friendlyError(status: number | undefined, message: string): string {
  if (status === 401) return `API anahtarı geçersiz veya süresi dolmuş (401). ${message}`
  if (status === 403) return `Bu işlem için yetkiniz yok (403). ${message}`
  if (status === 404) return `İstenen kaynak bulunamadı (404). ${message}`
  if (status === 429) return `Kota veya istek limiti aşıldı (429). Biraz bekleyip tekrar deneyin. ${message}`
  if (status && status >= 500) return `Sunucu hatası (${status}). ${message}`
  return message
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw || '{}'), null, 2)
  } catch {
    return raw
  }
}

function mvStatusLabel(status: MvResult['status']): string {
  if (status === 'ok') return 'tamam'
  if (status === 'error') return 'hata'
  return 'bekliyor'
}

function toolLabel(call: ToolCallInfo): string {
  if (call.name !== 'spawn_agent') return call.name
  try {
    const parsed = JSON.parse(call.arguments || '{}') as { agent?: string }
    return `Alt ajan · ${parsed.agent ?? 'explore'}`
  } catch {
    return 'Alt ajan'
  }
}

function flattenWorkspaceFiles(entries: WorkspaceEntry[]): Array<{ path: string; name: string }> {
  const files: Array<{ path: string; name: string }> = []
  const walk = (items: WorkspaceEntry[]): void => {
    for (const entry of items) {
      if (entry.type === 'file') files.push({ path: entry.path, name: entry.name })
      if (entry.children) walk(entry.children)
    }
  }
  walk(entries)
  return files
}

function mentionPaths(text: string): string[] {
  const paths: string[] = []
  const pattern = /(?:^|\s)@([^\s@]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match[1] && !paths.includes(match[1])) paths.push(match[1])
  }
  return paths
}

function expandTemplate(template: string, args: string): string {
  const positions =
    args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((value) => value.replace(/^"|"$/g, '')) ?? []
  let result = template.replace(/\$ARGUMENTS/g, args)
  result = result.replace(/\$(\d+)/g, (_, index: string) => positions[Number(index) - 1] ?? '')
  if (!template.includes('$ARGUMENTS') && !/\$\d+/.test(template) && args) {
    result += `\n\n${args}`
  }
  return result
}

export function Chat({
  model,
  sessionId,
  defaults,
  agent,
  multiverse,
  commands = [],
  summary,
  summaryMessageCount,
  compaction,
  initialMessages,
  workspacePath,
  initialTodos,
  onPersistUser,
  onPersistAssistant,
  onQuotaRefresh,
  onSessionUpdated,
  onNewChat,
  onOpenSettings,
  onOpenMemory,
  onOpenExtensions,
  onChooseWorkspace,
  onWorkspaceChanged,
  onTodosChange,
  onSettingsChanged
}: Props): React.JSX.Element {
  const [items, setItems] = useState<Item[]>(
    initialMessages.map((message) => ({ kind: 'message', ...message }))
  )
  const [dismissedSuggestionKey, setDismissedSuggestionKey] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [usage, setUsage] = useState<ChatUsage | null>(null)
  const [finish, setFinish] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [approval, setApproval] = useState<AgentApprovalRequest | null>(null)
  const [question, setQuestion] = useState<AgentQuestionRequest | null>(null)
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([])
  const [questionCustom, setQuestionCustom] = useState('')

  const [mvConfirm, setMvConfirm] = useState<MvConfirm | null>(null)
  const [mvResults, setMvResults] = useState<MvResult[]>([])
  const [mvPhase, setMvPhase] = useState<'idle' | 'members' | 'synthesis'>('idle')

  const [localSummary, setLocalSummary] = useState<string | null>(summary ?? null)
  const [localSummaryCount, setLocalSummaryCount] = useState<number>(summaryMessageCount ?? 0)
  const [paletteDismissed, setPaletteDismissed] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [compacting, setCompacting] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewArtifact, setReviewArtifact] = useState<Artifact | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [showTrace, setShowTrace] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [workspaceTick, setWorkspaceTick] = useState(0)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [todos, setTodos] = useState<TodoItem[]>(initialTodos)
  const [subagentTasks, setSubagentTasks] = useState<SubagentTaskInfo[]>([])
  const [profile, setProfile] = useState<AgentProfile>('build')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionFiles, setMentionFiles] = useState<Array<{ path: string; name: string }>>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)

  const requestRef = useRef<string | null>(null)
  const draftRef = useRef<Draft>({ ...EMPTY_DRAFT })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<number | null>(null)
  const recordStopTimerRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollRef = useRef(false)
  const usageRef = useRef<ChatUsage | null>(null)
  const stickToBottomRef = useRef(true)

  const scrollToBottom = useCallback((): void => {
    const element = scrollRef.current
    if (element) {
      programmaticScrollRef.current = true
      element.scrollTop = element.scrollHeight
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
    stickToBottomRef.current = true
    setShowScrollDown(false)
  }, [])

  function handleScroll(): void {
    if (programmaticScrollRef.current) return
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const atBottom = distance < 24
    stickToBottomRef.current = atBottom
    setShowScrollDown(!atBottom)
  }

  const copyMessage = useCallback(async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      setNotice('Mesaj kopyalandı.')
    } catch {
      setNotice('Mesaj kopyalanamadı.')
    }
  }, [])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`
  }, [input])

  const messages = useMemo(
    () =>
      items
        .filter((item): item is { kind: 'message' } & UiMessage => item.kind === 'message')
        .map((item) => ({ role: item.role, content: item.content, reasoning: item.reasoning })),
    [items]
  )

  const contextMessages = useMemo<ChatMessage[]>(() => {
    const base = messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
    if (!localSummary) return base
    return [
      { role: 'system', content: `Önceki konuşmanın özeti:\n${localSummary}` },
      ...base.slice(localSummaryCount)
    ]
  }, [messages, localSummary, localSummaryCount])

  const contextTokens = usage?.prompt_tokens ?? estimateMessagesTokens(contextMessages)
  const contextLength = model.context_length ?? null
  const contextPercent = contextLength
    ? Math.min(100, (contextTokens / contextLength) * 100)
    : null

  const commandQuery = input.startsWith('/') ? input.slice(1) : ''
  const filteredCommands = useMemo(() => {
    const needle = commandQuery.trim().toLowerCase()
    const list = needle
      ? commands.filter(
          (command) =>
            command.name.toLowerCase().includes(needle) ||
            (command.description ?? '').toLowerCase().includes(needle) ||
            command.category.toLowerCase().includes(needle)
        )
      : commands
    return list.slice(0, 40)
  }, [commands, commandQuery])

  const mentionMatches = useMemo(() => {
    const needle = mentionQuery.trim().toLowerCase()
    return mentionFiles
      .filter(
        (file) =>
          !needle ||
          file.path.toLowerCase().includes(needle) ||
          file.name.toLowerCase().includes(needle)
      )
      .slice(0, 8)
  }, [mentionFiles, mentionQuery])

  const paletteOpen =
    input.startsWith('/') &&
    !input.includes(' ') &&
    !paletteDismissed &&
    filteredCommands.length > 0

  useEffect(() => {
    setCommandIndex(0)
  }, [commandQuery])

  useEffect(() => {
    if (!mentionOpen || !workspacePath) return
    void api.workspace.tree().then((result) => {
      if (result.ok) setMentionFiles(flattenWorkspaceFiles(result.data))
    })
  }, [mentionOpen, workspacePath])

  const messageArtifacts = useMemo(() => {
    const map = new Map<number, Artifact[]>()
    items.forEach((item, index) => {
      if (item.kind === 'message' && item.role === 'assistant') {
        const list = extractArtifacts(item.content, `${sessionId}:${index}`)
        if (list.length > 0) map.set(index, list)
      } else if (item.kind === 'tool' && item.result?.content) {
        const list = extractArtifacts(item.result.content, `${sessionId}:tool:${index}`)
        if (list.length > 0) map.set(index, list)
      }
    })
    return map
  }, [items, sessionId])

  const allArtifacts = useMemo(
    () => [...messageArtifacts.values()].flat(),
    [messageArtifacts]
  )

  const openArtifact = useCallback((artifact: Artifact): void => {
    setReviewArtifact(artifact)
    setReviewOpen(true)
  }, [])

  const toggleReview = useCallback((): void => {
    if (reviewOpen) {
      setReviewOpen(false)
      return
    }
    setWorkspaceOpen(false)
    setTasksOpen(false)
    setGitOpen(false)
    if (reviewArtifact) {
      setReviewOpen(true)
      return
    }
    if (allArtifacts.length > 0) {
      setReviewArtifact(allArtifacts[allArtifacts.length - 1])
      setReviewOpen(true)
      return
    }
    setNotice(
      'İncelenecek dosya yok. Model bir dosya ürettiğinde (ör. ```markdown title="notlar.md") burada görünür.'
    )
  }, [allArtifacts, reviewArtifact, reviewOpen])

  const toggleWorkspace = useCallback((): void => {
    setReviewOpen(false)
    setTasksOpen(false)
    setGitOpen(false)
    setWorkspaceOpen((open) => !open)
  }, [])

  const toggleTasks = useCallback((): void => {
    setReviewOpen(false)
    setWorkspaceOpen(false)
    setGitOpen(false)
    setTasksOpen((open) => !open)
  }, [])

  const toggleGit = useCallback((): void => {
    setReviewOpen(false)
    setWorkspaceOpen(false)
    setTasksOpen(false)
    setGitOpen((open) => !open)
  }, [])

  const toggleTerminal = useCallback((): void => {
    setTerminalOpen((open) => !open)
  }, [])

  const toggleProfile = useCallback((): void => {
    setProfile((current) => (current === 'build' ? 'plan' : 'build'))
  }, [])

  useEffect(() => {
    const handler = (event: Event): void => {
      const command = (event as CustomEvent<string>).detail
      if (command === 'toggle-review') toggleReview()
      else if (command === 'toggle-workspace') toggleWorkspace()
      else if (command === 'toggle-git') toggleGit()
      else if (command === 'toggle-tasks') toggleTasks()
      else if (command === 'toggle-terminal') toggleTerminal()
      else if (command === 'toggle-plan' && agent.enabled) toggleProfile()
      else if (command === 'focus-composer') textareaRef.current?.focus()
    }
    window.addEventListener('evren:command', handler)
    return () => window.removeEventListener('evren:command', handler)
  }, [agent.enabled, toggleGit, toggleProfile, toggleReview, toggleTasks, toggleTerminal, toggleWorkspace])

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ language?: string; code?: string }>).detail
      if (!detail?.language || !detail.code) return
      setTerminalOpen(true)
      void api.terminal.runCode(detail.language, detail.code).then((result) => {
        if (!result.ok) {
          setNotice(result.error)
          return
        }
        if (!result.data.ok) setNotice(result.data.error ?? 'Kod çalıştırılamadı.')
      })
    }
    window.addEventListener('evren:run-code', handler)
    return () => window.removeEventListener('evren:run-code', handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event): void => {
      const text = (event as CustomEvent<string>).detail
      if (typeof text !== 'string' || !text.trim()) return
      setInput((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text))
      window.setTimeout(() => textareaRef.current?.focus(), 0)
    }
    window.addEventListener('evren:insert-input', handler)
    return () => window.removeEventListener('evren:insert-input', handler)
  }, [])

  const restoreCheckpoint = useCallback(
    async (id: string): Promise<void> => {
      if (!id || !window.confirm('Bu adımdaki dosya değişiklikleri geri alınsın mı?')) return
      const result = await api.workspace.restoreCheckpoint(id)
      if (!result.ok) {
        setNotice(`Geri alma hatası: ${result.error}`)
        return
      }
      setNotice(`${result.data.files} dosya geri alındı.`)
      setWorkspaceTick((tick) => tick + 1)
      onWorkspaceChanged()
    },
    [onWorkspaceChanged]
  )

  const answerQuestion = useCallback(
    async (answers: string[]): Promise<void> => {
      if (!question) return
      const cleaned = answers.map((answer) => answer.trim()).filter(Boolean)
      if (cleaned.length === 0) {
        setNotice('Bir seçenek seçin veya yanıt yazın.')
        return
      }
      const result = await api.agent.answerQuestion(
        question.requestId,
        question.question.id,
        cleaned
      )
      if (!result.ok || !result.data) {
        setNotice('Soru yanıtı iletilemedi.')
        return
      }
      setQuestion(null)
      setQuestionAnswers([])
      setQuestionCustom('')
    },
    [question]
  )

  const cancelQuestion = useCallback(async (): Promise<void> => {
    if (!question) return
    await api.agent.answerQuestion(question.requestId, question.question.id, [])
    setQuestion(null)
    setQuestionAnswers([])
    setQuestionCustom('')
  }, [question])

  const toggleTodo = useCallback(
    (id: string): void => {
      setTodos((current) => {
        const next = current.map((todo) => {
          if (todo.id !== id) return todo
          const status: TodoItem['status'] =
            todo.status === 'pending'
              ? 'in_progress'
              : todo.status === 'in_progress'
                ? 'completed'
                : 'pending'
          return { ...todo, status }
        })
        onTodosChange(next)
        return next
      })
    },
    [onTodosChange]
  )

  const clearTodos = useCallback((): void => {
    setTodos([])
    onTodosChange([])
  }, [onTodosChange])

  const cancelSubagent = useCallback(async (taskId: string): Promise<void> => {
    const result = await api.subagent.cancel(taskId)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    if (result.data.task) {
      setSubagentTasks((current) =>
        current.map((task) => (task.id === taskId ? result.data.task! : task))
      )
    }
    setNotice(result.data.cancelled ? 'Arka plan görevi iptal edildi.' : 'Görev zaten çalışmıyor.')
  }, [])

  const retrySubagent = useCallback(async (taskId: string): Promise<void> => {
    const result = await api.subagent.retry(taskId)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    if (result.data) {
      setSubagentTasks((current) =>
        current.map((task) => (task.id === taskId ? result.data! : task))
      )
    }
    setNotice('Alt-ajan görevi yeniden başlatıldı.')
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'r'
      ) {
        event.preventDefault()
        toggleReview()
      } else if (event.ctrlKey && event.key === '`') {
        event.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleReview, toggleTerminal])

  const suggestionState = useMemo(() => {
    const last = items[items.length - 1]
    if (!last || last.kind !== 'message' || last.role !== 'assistant') {
      return { key: '', replies: [] as string[] }
    }
    const content = last.content.trim()
    if (!content) return { key: '', replies: [] as string[] }
    const replies = suggestedRepliesFor(content)
    if (replies.length === 0) return { key: '', replies }
    return {
      key: `${items.length}:${content.length}:${content.slice(-24)}`,
      replies
    }
  }, [items])

  const showSuggestions =
    suggestionState.replies.length > 0 &&
    suggestionState.key !== dismissedSuggestionKey &&
    !streaming &&
    !input.trim() &&
    !approval

  const activeTasks = useMemo(() => {
    const tasks: string[] = []
    if (compacting) tasks.push('Oturum sıkıştırılıyor')

    if (mvPhase === 'members' || mvPhase === 'synthesis') {
      for (const member of mvResults) {
        if (member.status === 'pending') tasks.push(`Üye model: ${member.modelId}`)
      }
      if (mvPhase === 'synthesis') tasks.push(`Sentez: ${model.id}`)
    } else {
      const runningTools = items.filter(
        (item): item is { kind: 'tool'; call: ToolCallInfo; result?: ToolResultInfo } =>
          item.kind === 'tool' && !item.result
      )
      for (const tool of runningTools) tasks.push(`Araç: ${toolLabel(tool.call)}`)
      if (streaming) {
        tasks.push(agent.enabled ? 'Ajan yanıtı üretiliyor' : 'Yanıt üretiliyor')
      }
    }

    return tasks
  }, [agent.enabled, compacting, items, model.id, mvPhase, mvResults, streaming])

  useEffect(() => {
    if (activeTasks.length === 0) setTaskPanelOpen(false)
  }, [activeTasks.length])

  const renderArtifactToolbar = useCallback(
    (index: number): React.JSX.Element | null => {
      const artifacts = messageArtifacts.get(index)
      if (!artifacts || artifacts.length === 0) return null
      return (
        <div className="message-toolbar">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              className={`artifact-chip ${
                reviewArtifact?.id === artifact.id ? 'active' : ''
              }`}
              onClick={() => openArtifact(artifact)}
            >
              <span className="artifact-icon">▤</span>
              <span className="artifact-title">{artifact.title}</span>
              <span className="artifact-size">{formatBytes(artifact.bytes)}</span>
            </button>
          ))}
          <button
            className="review-toggle"
            title="İncelemeyi aç/kapat (Ctrl+Shift+R)"
            onClick={toggleReview}
          >
            ◫
          </button>
        </div>
      )
    },
    [messageArtifacts, openArtifact, reviewArtifact, toggleReview]
  )

  const commitDraft = useCallback(
    (persist: boolean, intermediate = false): void => {
      const final = draftRef.current
      if (!final.content.trim() && !final.reasoning.trim()) return
      setItems((prev) => [
        ...prev,
        {
          kind: 'message',
          role: 'assistant',
          content: final.content,
          reasoning: final.reasoning || undefined,
          intermediate
        }
      ])
      if (persist) {
        onPersistAssistant({
          content: final.content,
          reasoning: final.reasoning || undefined,
          usage: usageRef.current ?? undefined,
          finishReason: null
        })
      }
      draftRef.current = { ...EMPTY_DRAFT }
      setDraft(EMPTY_DRAFT)
    },
    [onPersistAssistant]
  )

  // Oturum degisince sifirla
  useEffect(() => {
    setItems(initialMessages.map((message) => ({ kind: 'message', ...message })))
    setDraft(EMPTY_DRAFT)
    setUsage(null)
    setFinish(null)
    setError(null)
    setStreaming(false)
    setApproval(null)
    setQuestion(null)
    setQuestionAnswers([])
    setQuestionCustom('')
    setMvConfirm(null)
    setMvResults([])
    setMvPhase('idle')
    setDismissedSuggestionKey(null)
    setLocalSummary(summary ?? null)
    setLocalSummaryCount(summaryMessageCount ?? 0)
    setPaletteDismissed(false)
    setNotice(null)
    setCommandIndex(0)
    setReviewOpen(false)
    setReviewArtifact(null)
    setWorkspaceOpen(false)
    setShowTrace(false)
    setTasksOpen(false)
    setGitOpen(false)
    setTodos(initialTodos)
    setSubagentTasks([])
    void api.subagent.list(sessionId).then((result) => {
      if (result.ok) setSubagentTasks(result.data)
    })
    setProfile('build')
    setMentionOpen(false)
    setMentionFiles([])
    setMentionQuery('')
    setTaskPanelOpen(false)
    draftRef.current = { ...EMPTY_DRAFT }
    usageRef.current = null
    requestRef.current = null
    stickToBottomRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Streaming olaylari
  useEffect(() => {
    const off = api.chat.onEvent((event) => {
      if (event.type === 'subagent-task') {
        if (event.task.sessionId && event.task.sessionId !== sessionId) return
        setSubagentTasks((current) => {
          const next = current.filter((task) => task.id !== event.task.id)
          return [event.task, ...next]
        })
        if (event.task.status === 'done') {
          void api.app.notify(
            'EVREN Desktop',
            `Alt ajan (${event.task.agentType}) görevi tamamlandı.`
          )
        } else if (event.task.status === 'error' || event.task.status === 'interrupted') {
          void api.app.notify(
            'EVREN Desktop',
            `Alt ajan (${event.task.agentType}) görevi başarısız/kesildi.`
          )
        }
        return
      }
      if (!requestRef.current || event.requestId !== requestRef.current) return

      if (event.type === 'content') {
        draftRef.current = { ...draftRef.current, content: draftRef.current.content + event.text }
        setDraft({ ...draftRef.current })
      } else if (event.type === 'reasoning') {
        draftRef.current = {
          ...draftRef.current,
          reasoning: draftRef.current.reasoning + event.text
        }
        setDraft({ ...draftRef.current })
      } else if (event.type === 'usage') {
        usageRef.current = event.usage
        setUsage(event.usage)
      } else if (event.type === 'tool-call') {
        commitDraft(false, true)
        setItems((prev) => [...prev, { kind: 'tool', call: event.call }])
      } else if (event.type === 'tool-result') {
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'tool' && item.call.id === event.result.toolCallId
              ? { ...item, result: event.result }
              : item
          )
        )
        if (event.result.todos) {
          setTodos(event.result.todos)
          onTodosChange(event.result.todos)
        }
        if (WORKSPACE_TOOL_NAMES.has(event.result.name)) {
          setWorkspaceTick((tick) => tick + 1)
          onWorkspaceChanged()
        }
      } else if (event.type === 'approval') {
        setApproval(event.request)
      } else if (event.type === 'question') {
        setQuestion(event.request)
        setQuestionAnswers([])
        setQuestionCustom('')
      } else if (event.type === 'multiverse-start') {
        setMvPhase('members')
        setMvResults(event.members.map((member) => ({ modelId: member, status: 'pending' })))
      } else if (event.type === 'multiverse-member') {
        setMvResults((prev) =>
          prev.map((item) =>
            item.modelId === event.result.modelId
              ? {
                  ...item,
                  status: event.result.ok ? 'ok' : 'error',
                  content: event.result.content,
                  error: event.result.error
                }
              : item
          )
        )
      } else if (event.type === 'multiverse-synthesis') {
        setMvPhase('synthesis')
      } else if (event.type === 'done') {
        commitDraft(true)
        setFinish(event.finishReason)
        setStreaming(false)
        setApproval(null)
        setQuestion(null)
        setMvPhase('idle')
        setMvConfirm(null)
        requestRef.current = null
        onQuotaRefresh?.()
        void api.memory.learn(sessionId)
        void api.app.notify('EVREN Desktop', 'Yanıt hazır.')
      } else if (event.type === 'error') {
        setError(friendlyError(event.status, event.error))
        setStreaming(false)
        setApproval(null)
        setQuestion(null)
        setMvPhase('idle')
        setMvConfirm(null)
        requestRef.current = null
        onQuotaRefresh?.()
      }
    })
    return off
  }, [commitDraft, onQuotaRefresh, onTodosChange, onWorkspaceChanged, sessionId])

  // Otomatik kaydirma: yalnizca kullanici en alttaysa
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, draft.content, draft.reasoning, streaming, approval, mvResults, mvPhase])

  const runRequest = useCallback(
    async (payloadMessages: ChatMessage[], options?: { multiverse?: boolean }): Promise<void> => {
      const requestId = crypto.randomUUID()
      requestRef.current = requestId
      draftRef.current = { ...EMPTY_DRAFT }
      setDraft(EMPTY_DRAFT)
      setError(null)
      setFinish(null)
      setUsage(null)
      usageRef.current = null
      setStreaming(true)
      setApproval(null)
      setQuestion(null)
      setQuestionAnswers([])
      setQuestionCustom('')

      const capabilities = model.capabilities
      const result = await api.chat.start({
        requestId,
        sessionId,
        model: model.id,
        messages: payloadMessages,
        temperature: defaults.temperature,
        top_p: defaults.top_p,
        max_tokens: defaults.max_tokens ?? Math.min(8192, model.default_max_output_tokens ?? 4096),
        reasoning_effort: capabilities?.reasoning_effort ? defaults.reasoning_effort : undefined,
        thinking: capabilities?.thinking ? defaults.thinking : undefined,
        agent: options?.multiverse
          ? undefined
          : agent.enabled
            ? { ...agent, profile }
            : undefined,
        multiverse: options?.multiverse
          ? { enabled: true, members: multiverse.members }
          : undefined
      })

      if (!result.ok) {
        setError(result.error)
        setStreaming(false)
        requestRef.current = null
        setMvPhase('idle')
      }
    },
    [agent, defaults, model, multiverse.members, profile, sessionId]
  )

  const maybeCompact = useCallback(async (): Promise<{
    summary: string | null
    count: number
  }> => {
    let currentSummary = localSummary
    let currentCount = localSummaryCount
    if (!compaction.auto || !model.context_length) {
      return { summary: currentSummary, count: currentCount }
    }

    const used = usage?.prompt_tokens ?? estimateMessagesTokens(contextMessages)
    const percent = (used / model.context_length) * 100
    if (percent < compaction.thresholdPercent) {
      return { summary: currentSummary, count: currentCount }
    }

    setCompacting(true)
    try {
      const result = await api.compaction.run(sessionId)
      if (result.ok && result.data.compacted) {
        currentSummary = result.data.summary ?? null
        currentCount = result.data.summaryMessageCount ?? 0
        setLocalSummary(currentSummary)
        setLocalSummaryCount(currentCount)
        onSessionUpdated()
        setNotice(
          `Oturum otomatik sıkıştırıldı (~${formatNumber(
            result.data.removedTokens ?? 0
          )} token).`
        )
      } else if (!result.ok) {
        setNotice(`Otomatik sıkıştırma başarısız: ${result.error}`)
      }
    } finally {
      setCompacting(false)
    }

    return { summary: currentSummary, count: currentCount }
  }, [
    compaction.auto,
    compaction.thresholdPercent,
    contextMessages,
    localSummary,
    localSummaryCount,
    model.context_length,
    onSessionUpdated,
    sessionId,
    usage?.prompt_tokens
  ])

  const runCompact = useCallback(
    async (focus?: string): Promise<void> => {
      setCompacting(true)
      setNotice(null)
      try {
        const result = await api.compaction.run(sessionId, focus)
        if (!result.ok) {
          setNotice(`Sıkıştırma hatası: ${result.error}`)
          return
        }
        if (!result.data.compacted) {
          setNotice(result.data.reason ?? 'Sıkıştırma yapılmadı.')
          return
        }
        setLocalSummary(result.data.summary ?? null)
        setLocalSummaryCount(result.data.summaryMessageCount ?? 0)
        onSessionUpdated()
        setNotice(
          `Oturum sıkıştırıldı (~${formatNumber(
            result.data.removedTokens ?? 0
          )} token özetlendi).`
        )
      } finally {
        setCompacting(false)
      }
    },
    [onSessionUpdated, sessionId]
  )

  const sendPrompt = useCallback(
    async (text: string, options?: { multiverse?: boolean }): Promise<void> => {
      const trimmed = text.trim()
      if (!trimmed || streaming) return

      const effective = await maybeCompact()
      const base = effective.summary
        ? [
            {
              role: 'system' as const,
              content: `Önceki konuşmanın özeti:\n${effective.summary}`
            },
            ...messages.slice(effective.count).map((message) => ({
              role: message.role,
              content: message.content
            }))
          ]
        : messages.map((message) => ({ role: message.role, content: message.content }))

      const references = mentionPaths(trimmed)
      let modelText = trimmed
      const textAttachments = attachments.filter((attachment) => attachment.kind === 'text')
      if (textAttachments.length > 0) {
        modelText += `\n\nEkli dosyalar:\n\n${textAttachments
          .map(
            (attachment) =>
              `### ${attachment.name}\n\n\`\`\`\n${attachment.content}\n\`\`\``
          )
          .join('\n\n')}`
      }
      if (references.length > 0) {
        const blocks: string[] = []
        for (const reference of references.slice(0, 8)) {
          const result = await api.workspace.read(reference)
          if (!result.ok || result.data.binary) continue
          blocks.push(
            `### ${result.data.path}\n\n\`\`\`\n${result.data.content.slice(0, 20_000)}\n\`\`\``
          )
        }
        if (blocks.length > 0) {
          modelText = `${modelText}\n\nBağlam dosyaları:\n\n${blocks.join('\n\n')}`
        }
      }

      const imageAttachments = attachments.filter(
        (attachment) => attachment.kind === 'image' && attachment.dataUrl
      )
      const imageParts = model.capabilities?.vision ? imageAttachments : []
      const userContent: ChatMessage['content'] =
        imageParts.length > 0
          ? [
              { type: 'text', text: modelText },
              ...imageParts.map((attachment) => ({
                type: 'image_url' as const,
                image_url: { url: attachment.dataUrl ?? '' }
              }))
            ]
          : `${modelText}${
              imageAttachments.length > 0 && !model.capabilities?.vision
                ? '\n\n[Görsel ekler bu modelde desteklenmiyor.]'
                : ''
            }`

      const nextItems: Item[] = [...items, { kind: 'message', role: 'user', content: trimmed }]
      setItems(nextItems)
      setInput('')
      setAttachments([])
      onPersistUser(trimmed)
      if (!options?.multiverse) {
        setMvResults([])
        setMvPhase('idle')
      }
      setNotice(null)
      stickToBottomRef.current = true
      setShowScrollDown(false)
      await runRequest([...base, { role: 'user', content: userContent }], options)
    },
    [attachments, items, maybeCompact, messages, model, onPersistUser, runRequest, streaming]
  )

  const executeCommand = useCallback(
    async (raw: string): Promise<void> => {
      const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(raw.trim())
      if (!match) {
        setNotice('Geçersiz komut.')
        return
      }

      const name = match[1]
      const args = (match[2] ?? '').trim()
      const command = commands.find((item) => item.name === name)
      if (!command) {
        setNotice(`Bilinmeyen komut: /${name}`)
        return
      }

      setInput('')
      setPaletteDismissed(true)
      setNotice(null)

      if (command.source === 'skill' && command.skillId) {
        const result = await api.commands.skill(command.skillId)
        if (result.ok && result.data) {
          await sendPrompt(`${result.data.content}${args ? `\n\n${args}` : ''}`)
        } else {
          setNotice('Beceri yüklenemedi.')
        }
        return
      }

      if (command.source === 'custom' && command.template) {
        await sendPrompt(expandTemplate(command.template, args))
        return
      }

      switch (command.name) {
        case 'compact':
          await runCompact(args || undefined)
          return
        case 'clear':
        case 'new':
          onNewChat()
          return
        case 'memory':
          onOpenMemory()
          return
        case 'remember': {
          if (!args) {
            setNotice('Kullanım: /remember <metin>')
            return
          }
          const result = await api.memory.add({ type: 'user', text: args })
          setNotice(result.ok ? 'Anı kaydedildi.' : `Hata: ${result.error}`)
          return
        }
        case 'forget': {
          if (!args) {
            setNotice('Kullanım: /forget <sorgu>')
            return
          }
          const result = await api.memory.deleteMatching(args)
          setNotice(result.ok ? `${result.data} anı silindi.` : `Hata: ${result.error}`)
          return
        }
        case 'skills':
          onOpenExtensions()
          return
        case 'skill': {
          if (!args) {
            setNotice('Kullanım: /skill <id>')
            return
          }
          const result = await api.commands.skill(args)
          if (result.ok && result.data) {
            await sendPrompt(result.data.content)
          } else {
            setNotice('Beceri bulunamadı.')
          }
          return
        }
        case 'settings':
          onOpenSettings()
          return
        case 'help':
          setNotice(commands.map((item) => `/${item.name}`).join(' · '))
          return
        default:
          setNotice(`Komut çalıştırılamadı: /${name}`)
      }
    },
    [
      commands,
      onNewChat,
      onOpenExtensions,
      onOpenMemory,
      onOpenSettings,
      runCompact,
      sendPrompt
    ]
  )

  const selectCommand = useCallback(
    (command: SlashCommand): void => {
      if (command.acceptsArguments) {
        setInput(`/${command.name} `)
        setPaletteDismissed(true)
        return
      }
      setInput('')
      setPaletteDismissed(true)
      void executeCommand(`/${command.name}`)
    },
    [executeCommand]
  )

  const send = useCallback(async (): Promise<void> => {
    const text = input.trim()
    if (!text || streaming) return

    if (text.startsWith('/')) {
      await executeCommand(text)
      return
    }

    if (multiverse.enabled) {
      if (multiverse.members.length === 0) {
        setError('Çoklu Evren için uygun üye model bulunamadı.')
        return
      }
      const estimate = estimateMultiverse({
        models: multiverse.models,
        primaryId: model.id,
        memberIds: multiverse.members,
        messages: [...contextMessages, { role: 'user', content: text }],
        maxTokens: defaults.max_tokens
      })
      setError(null)
      setMvConfirm({ ...estimate, text, members: multiverse.members })
      return
    }

    await sendPrompt(text)
  }, [
    contextMessages,
    defaults.max_tokens,
    executeCommand,
    input,
    model.id,
    multiverse,
    sendPrompt,
    streaming
  ])

  const sendSuggestion = useCallback(
    async (reply: string): Promise<void> => {
      const text = reply.trim()
      if (!text || streaming) return
      setDismissedSuggestionKey(suggestionState.key)
      await sendPrompt(text)
    },
    [sendPrompt, streaming, suggestionState.key]
  )

  const confirmMultiverse = useCallback(async (): Promise<void> => {
    if (!mvConfirm) return
    const text = mvConfirm.text
    setMvConfirm(null)
    setMvResults(mvConfirm.members.map((member) => ({ modelId: member, status: 'pending' })))
    setMvPhase('members')
    await sendPrompt(text, { multiverse: true })
  }, [mvConfirm, sendPrompt])

  const cancelMultiverse = useCallback((): void => {
    setMvConfirm(null)
    setMvPhase('idle')
  }, [])

  const retry = useCallback(async (): Promise<void> => {
    if (streaming || messages.length === 0) return
    await runRequest(
      messages.map((message) => ({ role: message.role, content: message.content })),
      { multiverse: multiverse.enabled }
    )
  }, [messages, multiverse.enabled, runRequest, streaming])

  const stop = useCallback(async (): Promise<void> => {
    if (requestRef.current) await api.chat.abort(requestRef.current)
  }, [])

  const respondApproval = useCallback(
    async (approved: boolean, always = false): Promise<void> => {
      if (!approval) return
      await api.agent.approve(
        approval.requestId,
        approval.toolCallId,
        approved,
        always,
        approval.category
      )
      if (approved && always) {
        setNotice(`"${approval.category}" kategorisi için her zaman izin verildi.`)
        onSettingsChanged()
      }
      setApproval(null)
    },
    [approval, onSettingsChanged]
  )

  const selectMention = useCallback(
    (path: string): void => {
      const at = input.lastIndexOf('@')
      const next = at >= 0 ? `${input.slice(0, at)}@${path} ` : `${input}@${path} `
      setInput(next)
      setMentionOpen(false)
      setMentionQuery('')
    },
    [input]
  )

  const addAttachments = useCallback(async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files).slice(0, 5)
    const next: PendingAttachment[] = []
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) continue
      try {
        if (file.type.startsWith('image/')) {
          next.push({
            id: crypto.randomUUID(),
            name: file.name || 'görsel',
            kind: 'image',
            content: '',
            dataUrl: await fileToDataUrl(file)
          })
        } else {
          const text = await file.text()
          next.push({
            id: crypto.randomUUID(),
            name: file.name || 'dosya.txt',
            kind: 'text',
            content: text.slice(0, 40_000)
          })
        }
      } catch {
        // okunamayan dosyayı atla
      }
    }
    if (next.length > 0) {
      setAttachments((current) => [...current, ...next].slice(0, 5))
    }
  }, [])

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }, [])

  const clearRecordTimers = useCallback((): void => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    if (recordStopTimerRef.current !== null) {
      window.clearTimeout(recordStopTimerRef.current)
      recordStopTimerRef.current = null
    }
  }, [])

  const finishRecording = useCallback(async (): Promise<void> => {
    clearRecordTimers()
    const recorder = mediaRecorderRef.current
    const mimeType = recorder?.mimeType || 'audio/webm'
    mediaRecorderRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    const chunks = mediaChunksRef.current
    mediaChunksRef.current = []
    setRecording(false)
    setRecordSeconds(0)
    if (chunks.length === 0) {
      setNotice('Ses kaydı boş.')
      return
    }
    setTranscribing(true)
    try {
      const blob = new Blob(chunks, { type: mimeType })
      const data = await blob.arrayBuffer()
      const result = await api.audio.transcribe({
        data,
        mimeType,
        filename: `kayit-${Date.now()}.webm`
      })
      if (!result.ok) {
        setNotice(`Transkripsiyon hatası: ${result.error}`)
        return
      }
      setInput((current) =>
        current ? `${current} ${result.data.text}` : result.data.text
      )
      textareaRef.current?.focus()
      setNotice('Ses metne çevrildi.')
    } catch (error) {
      setNotice(
        `Transkripsiyon hatası: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setTranscribing(false)
    }
  }, [clearRecordTimers])

  const stopRecording = useCallback((): void => {
    clearRecordTimers()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      setRecording(false)
      setRecordSeconds(0)
    }
  }, [clearRecordTimers])

  const startRecording = useCallback(async (): Promise<void> => {
    if (recording || transcribing) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice('Bu ortamda mikrofon kaydı desteklenmiyor.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      mediaChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        void finishRecording()
      }
      recorder.start()
      setRecording(true)
      setRecordSeconds(0)
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((seconds) => seconds + 1)
      }, 1000)
      recordStopTimerRef.current = window.setTimeout(() => {
        stopRecording()
      }, 120_000)
    } catch (error) {
      setNotice(
        `Mikrofon açılamadı: ${error instanceof Error ? error.message : String(error)}`
      )
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [finishRecording, recording, stopRecording, transcribing])

  useEffect(() => {
    return () => {
      clearRecordTimers()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = null
        mediaRecorderRef.current.stop()
      }
      mediaRecorderRef.current = null
    }
  }, [clearRecordTimers])

  function handleInputChange(value: string): void {
    setInput(value)
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value)
    if (match && workspacePath) {
      setMentionQuery(match[1] ?? '')
      setMentionOpen(true)
      setMentionIndex(0)
      return
    }
    setMentionOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionOpen && mentionMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((index) => (index + 1) % mentionMatches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex(
          (index) => (index - 1 + mentionMatches.length) % mentionMatches.length
        )
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const file = mentionMatches[mentionIndex]
        if (file) selectMention(file.path)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionOpen(false)
        return
      }
    }
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      if (agent.enabled) toggleProfile()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const traceItemCount = items.filter(
    (item) => item.kind === 'tool' || (item.kind === 'message' && item.intermediate)
  ).length
  const hasConversation = items.length > 0 || draft.content || draft.reasoning
  const showAgentBanner =
    agent.enabled && profile === 'build' && agent.mode === 'auto' && !multiverse.enabled
  const showPlanBanner = agent.enabled && profile === 'plan' && !multiverse.enabled
  const doneTodos = todos.filter((todo) => todo.status === 'completed').length
  const runningSubagents = subagentTasks.filter((task) => task.status === 'running').length
  const workspaceName = workspacePath
    ? workspacePath.includes('evren-workspaces')
      ? 'Geçici'
      : workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  return (
    <div className="chat">
      {multiverse.enabled && (
        <div className="mv-banner">
          <span>
            ÇOKLU EVREN — {multiverse.members.length} üye model + sentez. Üye modeller araç
            kullanmaz.
          </span>
          {streaming && (
            <button className="btn-ghost danger" onClick={() => void stop()}>
              Hemen durdur
            </button>
          )}
        </div>
      )}

      {showPlanBanner && (
        <div className="agent-banner plan-banner">
          <span>PLAN MODU — değişiklik yapılmaz; analiz, plan ve görev listesi.</span>
          {streaming && (
            <button className="btn-ghost danger" onClick={() => void stop()}>
              Hemen durdur
            </button>
          )}
        </div>
      )}

      {showAgentBanner && (
        <div className="agent-banner">
          <span>OTOMATİK MOD — ajan sizin yerinize eylem yapabilir.</span>
          {streaming && (
            <button className="btn-ghost danger" onClick={() => void stop()}>
              Hemen durdur
            </button>
          )}
        </div>
      )}

      <div className="chat-split">
        <div className="chat-main">
          <div className="chat-statusbar">
            <button
              className={`btn-ghost ${terminalOpen ? 'active' : ''}`}
              onClick={toggleTerminal}
              title="Terminali aç/kapat (Ctrl+`)"
            >
              Terminal
            </button>
            <button
              className={`btn-ghost ${showTrace ? 'active' : ''}`}
              onClick={() => setShowTrace((value) => !value)}
              title="Araç çağrılarını ve ara mesajları göster/gizle"
              disabled={traceItemCount === 0}
            >
              Ara adımlar{traceItemCount > 0 ? ` (${traceItemCount})` : ''}
            </button>
            <button
              className="btn-ghost"
              onClick={toggleReview}
              title="İncelemeyi aç/kapat (Ctrl+Shift+R)"
            >
              İnceleme
            </button>
            <button
              className={`btn-ghost ${workspaceOpen ? 'active' : ''}`}
              onClick={toggleWorkspace}
              title="Çalışma alanı dosyaları ve değişiklikler"
            >
              Dosyalar{workspaceName ? ` · ${workspaceName}` : ''}
            </button>
            {workspacePath && (
              <button
                className={`btn-ghost ${gitOpen ? 'active' : ''}`}
                onClick={toggleGit}
                title="Git durumu, commit ve worktree'ler"
              >
                Git
              </button>
            )}
            {(todos.length > 0 || subagentTasks.length > 0) && (
              <button
                className={`btn-ghost ${tasksOpen ? 'active' : ''}`}
                onClick={toggleTasks}
                title="Görev listesini ve arka plan görevlerini aç"
              >
                Görevler{' '}
                <span className="status-count">
                  {todos.length > 0
                    ? `${doneTodos}/${todos.length}`
                    : `${runningSubagents}/${subagentTasks.length}`}
                </span>
              </button>
            )}
            {activeTasks.length > 0 && (
              <div className="task-anchor">
                <button
                  className="task-pill"
                  onClick={() => setTaskPanelOpen((open) => !open)}
                >
                  <span className="task-spinner" />
                  <span>{activeTasks.length} çalışıyor</span>
                  <span className="task-more">···</span>
                </button>
                {taskPanelOpen && (
                  <div className="task-popover">
                    <div className="task-popover-head">Çalışan görevler</div>
                    <ul>
                      {activeTasks.map((task, index) => (
                        <li key={index}>{task}</li>
                      ))}
                    </ul>
                    <button className="btn-ghost danger" onClick={() => void stop()}>
                      Durdur
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className="chat-scroll"
            ref={scrollRef}
            onScroll={handleScroll}
            role="log"
            aria-label="Sohbet mesajları"
            aria-live="polite"
            aria-relevant="additions text"
            onWheel={(event) => {
              const element = scrollRef.current
              if (event.deltaY < 0 && element && element.scrollTop > 0) {
                stickToBottomRef.current = false
                setShowScrollDown(true)
              }
            }}
          >
        {!hasConversation && (
          <div className="chat-empty">
            <p>{model.id} ile sohbet başlatın.</p>
            <p className="muted">Enter ile gönder · Shift+Enter yeni satır</p>
            {multiverse.enabled && (
              <p className="muted">
                Çoklu Evren: {multiverse.members.length} üye model + ana model sentezi.
              </p>
            )}
            {agent.enabled && !multiverse.enabled && (
              <p className="muted">
                {profile === 'plan'
                  ? 'Plan modu: salt-okunur araçlar etkin.'
                  : `Ajan etkin: ${agent.browser ? 'tarayıcı' : ''}${
                      agent.browser && agent.computer ? ' + ' : ''
                    }${agent.computer ? 'bilgisayar' : ''} araçları kullanılabilir.`}
              </p>
            )}
            {agent.enabled && (
              <p className="muted">
                Plan/Build: <kbd>Shift</kbd>+<kbd>Tab</kbd> · Dosya bağlamı: <kbd>@</kbd>
              </p>
            )}
          </div>
        )}

        {mvResults.length > 0 && (
          <details className="mv-section">
            <summary className="mv-title">
              <span className="mv-title-label">Çoklu Evren</span>
              <span className="mv-title-meta">
                {mvResults.filter((result) => result.status === 'ok').length}/{mvResults.length}{' '}
                yanıt · genişlet
              </span>
            </summary>
            <div className="mv-cards">
              {mvResults.map((result) => (
                <details key={result.modelId} className={`mv-card mv-${result.status}`}>
                  <summary>
                    <span className="mv-model">{result.modelId}</span>
                    <span className="mv-status">{mvStatusLabel(result.status)}</span>
                  </summary>
                  {result.content && (
                    <pre className="mv-content">{result.content.slice(0, 4000)}</pre>
                  )}
                  {result.error && <p className="error">{result.error}</p>}
                </details>
              ))}
            </div>
          </details>
        )}

        {mvPhase === 'synthesis' && <div className="mv-synthesis-label">Sentez</div>}

        {items.map((item, index) => {
          const hidden =
            item.kind === 'tool' || (item.kind === 'message' && item.intermediate)
          if (!showTrace && hidden) return null
          return item.kind === 'tool' ? (
            <details
              key={index}
              className={`tool-card ${
                item.result ? (item.result.ok ? 'tool-ok' : 'tool-fail') : 'tool-pending'
              } ${item.call.name === 'spawn_agent' ? 'tool-subagent' : ''}`}
            >
              <summary className="tool-head">
                <span className="tool-name">{toolLabel(item.call)}</span>
                <span className="tool-status">
                  {item.result ? (item.result.ok ? 'tamam' : 'hata') : 'çalışıyor...'}
                </span>
              </summary>
              <pre className="tool-args">{prettyJson(item.call.arguments)}</pre>
              {item.result && (
                <pre className="tool-result">
                  {item.result.content.slice(0, item.call.name === 'spawn_agent' ? 5000 : 1500)}
                </pre>
              )}
              {item.result?.imageDataUrl && (
                <img className="tool-image" src={item.result.imageDataUrl} alt="araç görüntüsü" />
              )}
              {renderArtifactToolbar(index)}
              {item.result?.checkpointId && item.result.ok && (
                <div className="tool-actions">
                  <button
                    className="btn-ghost"
                    onClick={() => void restoreCheckpoint(item.result?.checkpointId ?? '')}
                  >
                    ↶ Bu adımı geri al
                  </button>
                </div>
              )}
            </details>
          ) : (
            <div key={index} className={`msg msg-${item.role}`}>
              {item.role === 'assistant' && item.reasoning && showTrace && (
                <details className="reasoning">
                  <summary>Düşünme</summary>
                  <pre>{item.reasoning}</pre>
                </details>
              )}
              <div className="bubble">
                {item.role === 'assistant' ? (
                  <div className="md">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}
                    >
                      {item.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  item.content
                )}
              </div>
              {renderArtifactToolbar(index)}
              {item.content.trim() && (
                <div className="message-actions">
                  <button
                    onClick={() => void copyMessage(item.content)}
                    title="Mesajı kopyala"
                  >
                    ⧉ Kopyala
                  </button>
                  {item.role === 'assistant' &&
                    index === items.length - 1 &&
                    !streaming && (
                      <button onClick={() => void retry()} title="Yanıtı yeniden üret">
                        ↻ Yeniden üret
                      </button>
                    )}
                </div>
              )}
            </div>
          )
        })}

        {(draft.content || (showTrace && draft.reasoning)) && (
          <div className="msg msg-assistant">
            {draft.reasoning && showTrace && (
              <details className="reasoning">
                <summary>Düşünüyor...</summary>
                <pre>{draft.reasoning}</pre>
              </details>
            )}
            <div className="bubble">
              {draft.content ? (
                <div className="md">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}
                  >
                    {draft.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="typing">● ● ●</span>
              )}
            </div>
          </div>
        )}

        {streaming && !draft.content && (
          <div className="msg msg-assistant">
            <div className="bubble">
              <span className="typing">● ● ●</span>
            </div>
          </div>
        )}

        {approval && (
          <div className="approval">
            <div className="approval-head">
              <span>Ajan izin istiyor</span>
              <span className={`approval-category approval-${approval.category}`}>
                {PERMISSION_LABELS[approval.category]}
              </span>
            </div>
            <div className="approval-summary">{approval.summary}</div>
            <pre className="approval-args">
              {JSON.stringify(approval.args, null, 2).slice(0, 4000)}
            </pre>
            <div className="approval-actions">
              <button className="btn-ghost danger" onClick={() => void respondApproval(false)}>
                Reddet
              </button>
              <button className="btn-ghost" onClick={() => void respondApproval(true)}>
                Bir kez izin ver
              </button>
              <button className="btn" onClick={() => void respondApproval(true, true)}>
                Her zaman izin ver
              </button>
            </div>
          </div>
        )}

        {question && (
          <div className="approval question-card">
            <div className="approval-head">
              <span>{question.question.header || 'Ajan soru soruyor'}</span>
            </div>
            <div className="approval-summary">{question.question.question}</div>
            {question.question.options.length > 0 && (
              <div className="question-options">
                {question.question.options.map((option) => {
                  const checked = questionAnswers.includes(option.label)
                  return (
                    <label key={option.label} className="question-option">
                      <input
                        type={question.question.multiple ? 'checkbox' : 'radio'}
                        name={`question-${question.question.id}`}
                        checked={checked}
                        onChange={() => {
                          if (question.question.multiple) {
                            setQuestionAnswers((current) =>
                              checked
                                ? current.filter((value) => value !== option.label)
                                : [...current, option.label]
                            )
                          } else {
                            setQuestionAnswers([option.label])
                          }
                        }}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        {option.description ? (
                          <small className="muted">{option.description}</small>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            <input
              className="question-custom"
              value={questionCustom}
              onChange={(event) => setQuestionCustom(event.target.value)}
              placeholder="Farklı bir yanıt yazın (isteğe bağlı)"
            />
            <div className="approval-actions">
              <button className="btn-ghost danger" onClick={() => void cancelQuestion()}>
                Vazgeç
              </button>
              <button
                className="btn"
                onClick={() =>
                  void answerQuestion([...questionAnswers, questionCustom])
                }
              >
                Yanıtla
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="error-block">
            <p className="error">{error}</p>
            <button className="btn-ghost" onClick={() => void retry()}>
              Yeniden dene
            </button>
          </div>
        )}
      </div>

      {showScrollDown && (
        <button
          className="scroll-bottom"
          onClick={() => scrollToBottom()}
          title="En alta in"
          aria-label="En alta in"
        >
          ↓
        </button>
      )}

      {notice && (
        <div className="chat-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {paletteOpen && (
        <CommandPalette
          commands={commands}
          query={commandQuery}
          activeIndex={commandIndex}
          onSelect={selectCommand}
          onHover={setCommandIndex}
        />
      )}

      {showSuggestions && (
        <div className="quick-replies" aria-label="Önerilen yanıtlar">
          <div className="quick-replies-label">Önerilen yanıt</div>
          <div className="quick-replies-list">
            {suggestionState.replies.map((reply) => (
              <button
                className="quick-reply"
                key={reply}
                onClick={() => {
                  setInput(reply)
                  window.setTimeout(() => textareaRef.current?.focus(), 0)
                }}
                title="Yanıtı düzenlemek için yazı kutusuna ekle"
              >
                {reply}
              </button>
            ))}
          </div>
          <button
            className="quick-reply-approve"
            onClick={() => void sendSuggestion(suggestionState.replies[0])}
            disabled={streaming}
            title="Önerilen yanıtı doğrudan gönder"
          >
            ✓ Onayla ve gönder
          </button>
          <button
            className="quick-replies-dismiss"
            onClick={() => setDismissedSuggestionKey(suggestionState.key)}
            title="Önerileri gizle"
            aria-label="Önerileri gizle"
          >
            ✕
          </button>
        </div>
      )}

      <div className="composer">
        <div className="composer-top">
          <button
            className={`composer-mode ${profile === 'plan' ? 'active' : ''}`}
            onClick={toggleProfile}
            disabled={!agent.enabled || streaming}
            title={
              agent.enabled
                ? 'Plan / Build modu (Shift+Tab)'
                : 'Plan modu için ajan araçları gerekir'
            }
            aria-pressed={profile === 'plan'}
          >
            <span className="composer-mode-dot" />
            {profile === 'plan' ? 'Plan' : 'Build'}
          </button>
          {profile === 'plan' && (
            <span className="composer-mode-hint">Değişiklik yapmadan analiz eder</span>
          )}
          <button
            className="composer-mode"
            onClick={() => {
              setInput((value) => `${value}${value && !value.endsWith(' ') ? ' ' : ''}@`)
              setMentionQuery('')
              setMentionOpen(true)
            }}
            disabled={!workspacePath || streaming}
            title={
              workspacePath
                ? 'Dosya bağlamı ekle (@)'
                : 'Dosya bağlamı için çalışma alanı seçin'
            }
          >
            @ Dosya
          </button>
          <button
            className="composer-mode"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            title="Görsel veya metin dosyası ekle"
          >
            📎 Ekle
          </button>
          <button
            className={`composer-mode ${recording ? 'recording' : ''}`}
            onClick={() => {
              if (recording) stopRecording()
              else void startRecording()
            }}
            disabled={transcribing || streaming}
            title={
              transcribing
                ? 'Ses metne çevriliyor...'
                : recording
                  ? 'Kaydı durdur'
                  : 'Sesle yaz'
            }
            aria-label={recording ? 'Ses kaydını durdur' : 'Sesle yaz'}
            aria-pressed={recording}
          >
            {transcribing ? '…' : recording ? `⏹ ${recordSeconds}s` : '🎙 Ses'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.css,.html,.yml,.yaml,.csv,.log"
            onChange={(event) => {
              if (event.target.files) void addAttachments(event.target.files)
              event.target.value = ''
            }}
          />
          {profile === 'plan' && hasConversation && !streaming && (
            <button
              className="btn-ghost composer-apply"
              onClick={() => {
                setProfile('build')
                setInput('Planı uygula ve değişiklikleri yap.')
              }}
            >
              Planı uygula
            </button>
          )}
        </div>
        {mentionOpen && (
          <div className="mention-popover">
            <div className="mention-head">Dosya bağlamı ekle</div>
            {mentionMatches.length === 0 ? (
              <p className="mention-empty">Eşleşen dosya yok.</p>
            ) : (
              mentionMatches.map((file, index) => (
                <button
                  key={file.path}
                  className={`mention-item ${index === mentionIndex ? 'active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectMention(file.path)
                  }}
                >
                  <span className="mention-icon">▤</span>
                  <span className="mention-path">{file.path}</span>
                </button>
              ))
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <span className="attach-chip" key={attachment.id}>
                <span>{attachment.kind === 'image' ? '🖼' : '📎'}</span>
                <span className="attach-name">{attachment.name}</span>
                <button
                  className="attach-remove"
                  onClick={() => removeAttachment(attachment.id)}
                  title="Eki kaldır"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              void addAttachments(files)
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            if (event.dataTransfer.files.length > 0) {
              void addAttachments(event.dataTransfer.files)
            }
          }}
          placeholder={
            streaming
              ? 'Yanıt sürerken yazabilirsiniz...'
              : approval
                ? 'Ajan onay bekliyor...'
                : profile === 'plan'
                  ? 'Plan modu: incele, analiz et, plan çıkar...'
                  : multiverse.enabled
                    ? 'Çoklu Evren için mesajınızı yazın...'
                    : 'Mesajınızı yazın...'
          }
          rows={3}
        />
        <div className="composer-actions">
          <span className="meta">
            {contextLength !== null && contextPercent !== null && (
              <span
                className={`context-meter ${
                  contextPercent >= compaction.thresholdPercent ? 'warn' : ''
                }`}
              >
                bağlam: {contextPercent.toFixed(0)}%
              </span>
            )}
            {compacting && <span className="context-meter">sıkıştırılıyor...</span>}
            {usage
              ? `${formatNumber(usage.prompt_tokens ?? null)} girdi · ${formatNumber(
                  usage.completion_tokens ?? null
                )} çıktı`
              : ''}
            {finish ? ` · bitiş: ${finish}` : ''}
          </span>
          {streaming ? (
            <button className="btn btn-stop" onClick={() => void stop()}>
              Durdur
            </button>
          ) : (
            <button className="btn" onClick={() => void send()} disabled={!input.trim()}>
              Gönder
            </button>
          )}
        </div>
      </div>
        {terminalOpen && (
          <TerminalPanel
            workspacePath={workspacePath}
            onClose={() => setTerminalOpen(false)}
          />
        )}
        </div>

        {reviewOpen && reviewArtifact && (
          <ReviewPane
            artifact={reviewArtifact}
            onClose={() => setReviewOpen(false)}
          />
        )}

        {workspaceOpen && (
          <WorkspacePanel
            workspacePath={workspacePath}
            refreshKey={workspaceTick}
            onChoose={onChooseWorkspace}
            onClose={() => setWorkspaceOpen(false)}
            onChanged={onWorkspaceChanged}
          />
        )}

        {tasksOpen && (
          <TasksPanel
            todos={todos}
            subagentTasks={subagentTasks}
            onToggle={toggleTodo}
            onClear={clearTodos}
            onCancelSubagent={cancelSubagent}
            onRetrySubagent={retrySubagent}
            onClose={() => setTasksOpen(false)}
          />
        )}

        {gitOpen && (
          <GitPanel
            workspacePath={workspacePath}
            refreshKey={workspaceTick}
            onClose={() => setGitOpen(false)}
            onChanged={onWorkspaceChanged}
          />
        )}
      </div>

      {mvConfirm && (
        <div className="modal-overlay" onClick={cancelMultiverse}>
          <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Çoklu Evren</h2>
              <button className="btn-ghost" onClick={cancelMultiverse}>
                Kapat
              </button>
            </div>
            <div className="modal-body">
              <p className="muted">
                Ana model <code>{model.id}</code> · {mvConfirm.members.length} üye + sentez ={' '}
                {mvConfirm.members.length + 1} çağrı
              </p>
              <div className="mv-member-list">
                {mvConfirm.members.map((member) => (
                  <span key={member} className="chip">
                    {member}
                  </span>
                ))}
              </div>
              <div className="mv-estimate">
                <div>
                  <span>Tahmini girdi</span>
                  <strong>{formatNumber(mvConfirm.promptTokens)} token</strong>
                </div>
                <div>
                  <span>Tahmini çıktı</span>
                  <strong>
                    {formatNumber(
                      mvConfirm.memberOutputTokens * mvConfirm.members.length +
                        mvConfirm.synthesisOutputTokens
                    )}{' '}
                    token
                  </strong>
                </div>
                <div>
                  <span>Tahmini maliyet</span>
                  <strong>
                    {mvConfirm.cost === null
                      ? 'fiyat bilgisi yok'
                      : `~${mvConfirm.cost.toFixed(4)} ${mvConfirm.currency}`}
                  </strong>
                </div>
              </div>
              <p className="params-note">
                Üye modeller araç kullanmaz. Yanıtlar ana model tarafından sentezlenir.
                Tahminler yaklaşıktır.
              </p>
              <div className="inline-actions">
                <button className="btn-ghost" onClick={cancelMultiverse}>
                  Vazgeç
                </button>
                <button className="btn" onClick={() => void confirmMultiverse()}>
                  Çalıştır
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
