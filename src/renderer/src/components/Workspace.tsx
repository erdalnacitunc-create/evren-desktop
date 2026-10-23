import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TASK_LABELS,
  type AppSettings,
  type ChatDefaults,
  type KeyStatus,
  type ModelInfo,
  type QuotaStatus,
  type Session,
  type SessionSummary,
  type SlashCommand,
  type TodoItem
} from '@shared/types'
import { api, formatContext, formatNumber } from '../lib/ipc'
import { AgentPanel } from './AgentPanel'
import { Chat } from './Chat'
import { EvrenLogo } from './EvrenLogo'
import { GlobalCommandPalette, type PaletteAction } from './GlobalCommandPalette'
import { ParamsPanel } from './ParamsPanel'
import { SettingsModal } from './SettingsModal'

interface Props {
  models: ModelInfo[]
  quota: QuotaStatus | null
  keyStatus: KeyStatus | null
  settings: AppSettings
  onSignOut: () => void
  onRefresh: () => void
  onSettingsChange: (settings: AppSettings) => void
}

function formatRelative(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'az önce'
  if (minutes < 60) return `${minutes} dk`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} gün`
  return new Date(timestamp).toLocaleDateString('tr-TR')
}

function formatCountdown(resetAt: string | null, now: number): string {
  if (!resetAt) return ''
  const ms = new Date(resetAt).getTime() - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'sıfırlanıyor'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}sa ${minutes}dk` : `${minutes}dk`
}

function QuotaBar({ quota, now }: { quota: QuotaStatus | null; now: number }): React.JSX.Element {
  if (!quota) return <span className="quota-empty">Kota bilgisi alınamadı</span>
  const used = quota.daily_used_tokens ?? 0
  const limit = quota.daily_limit_tokens
  const ratio = limit ? Math.min(1, used / limit) : 0

  return (
    <div className={`quota quota-${quota.level}`}>
      <div className="quota-text">
        <strong>{formatNumber(quota.daily_remaining_tokens ?? null)}</strong>
        <span> / {formatNumber(limit)} günlük token kaldı</span>
      </div>
      <div className="quota-track">
        <div className="quota-fill" style={{ width: `${(ratio * 100).toFixed(2)}%` }} />
      </div>
      <div className="quota-sub">
        Kredi: {quota.remaining_cr} CR · Pencere: {formatNumber(quota.used_tokens)}/
        {formatNumber(quota.cap)}
        {quota.daily_reset_at && ` · sıfırlanma: ${formatCountdown(quota.daily_reset_at, now)}`}
      </div>
    </div>
  )
}

export function Workspace({
  models,
  quota,
  keyStatus,
  settings,
  onSignOut,
  onRefresh,
  onSettingsChange
}: Props): React.JSX.Element {
  const chatModels = useMemo(() => {
    const filtered = models.filter((m) => m.task === 'chat' || m.task === 'vision_chat')
    return filtered.length > 0 ? filtered : models
  }, [models])

  const defaultModelId = chatModels[0]?.id ?? models[0]?.id ?? ''

  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [quotaState, setQuotaState] = useState<QuotaStatus | null>(quota)
  const [now, setNow] = useState(Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paramsOpen, setParamsOpen] = useState(false)
  const [closePrompt, setClosePrompt] = useState<{
    sessionId: string
    title: string
    workspacePath: string
  } | null>(null)
  const [closeNotice, setCloseNotice] = useState<string | null>(null)
  const [settingsTab, setSettingsTab] = useState<
    'general' | 'extensions' | 'memory' | 'github' | 'scheduled' | 'mcp' | 'api'
  >('general')
  const [commands, setCommands] = useState<SlashCommand[]>([])
  // Ajan (araclar) varsayilan olarak acik; kullanici kapatabilir.
  const [agentEnabled, setAgentEnabled] = useState(true)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [multiverseEnabled, setMultiverseEnabled] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const isMac = api.platform === 'darwin'

  const activeIdRef = useRef<string | null>(null)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    setQuotaState(quota)
  }, [quota])

  useEffect(() => {
    void api.appWindow.isMaximized().then((result) => {
      if (result.ok) setMaximized(result.data)
    })
    return api.appWindow.onMaximized((value) => setMaximized(value))
  }, [])

  // Komutlar
  useEffect(() => {
    void api.commands.list().then((result) => {
      if (result.ok) setCommands(result.data)
    })
  }, [])

  const refreshActiveSession = useCallback(async (): Promise<void> => {
    const id = activeIdRef.current
    if (!id) return
    const result = await api.sessions.get(id)
    if (result.ok && result.data) setActiveSession(result.data)
  }, [])

  const openSettingsTab = useCallback(
    (
      tab: 'general' | 'extensions' | 'memory' | 'github' | 'scheduled' | 'mcp' | 'api'
    ): void => {
      setSettingsTab(tab)
      setSettingsOpen(true)
    },
    []
  )

  // Kota: periyodik yenileme
  const refreshQuota = useCallback(async (): Promise<void> => {
    const result = await api.quota.get()
    if (result.ok) setQuotaState(result.data)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => void refreshQuota(), 45_000)
    return () => clearInterval(timer)
  }, [refreshQuota])

  // Geri sayim
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const openSession = useCallback(async (id: string): Promise<void> => {
    const result = await api.sessions.get(id)
    if (!result.ok || !result.data) return
    let session = result.data
    if (!session.workspacePath) {
      const temp = await api.workspace.createTemp()
      if (temp.ok) {
        const linked = await api.sessions.setWorkspace(id, temp.data.path, true)
        if (linked.ok && linked.data) session = linked.data
      }
    } else {
      await api.sessions.activateWorkspace(id)
    }
    setActiveId(id)
    setActiveSession(session)
    const config = await api.settings.get()
    if (config.ok) onSettingsChange(config.data)
  }, [onSettingsChange])

  const refreshList = useCallback(async (search: string): Promise<SessionSummary[] | null> => {
    const result = search.trim()
      ? await api.sessions.search(search)
      : await api.sessions.list()
    if (!result.ok) return null
    setSessions(result.data)
    return result.data
  }, [])

  // Ilk yukleme: oturum varsa en sonuncuyu ac, yoksa olustur
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const listResult = await api.sessions.list()
      if (!listResult.ok) return
      let list = listResult.data

      if (list.length === 0) {
        const created = await api.sessions.create(defaultModelId)
        if (!created.ok) return
        let session = created.data
        const temp = await api.workspace.createTemp()
        if (temp.ok) {
          const linked = await api.sessions.setWorkspace(session.id, temp.data.path, true)
          if (linked.ok && linked.data) session = linked.data
        }
        const again = await api.sessions.list()
        if (again.ok) list = again.data
        if (cancelled) return
        setSessions(list)
        setActiveId(session.id)
        setActiveSession(session)
        const config = await api.settings.get()
        if (config.ok) onSettingsChange(config.data)
        return
      }

      if (cancelled) return
      setSessions(list)
      const target = list[0]
      if (target) {
        await openSession(target.id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [defaultModelId, onSettingsChange, openSession])

  // Arama (kisa debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshList(query)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, refreshList])

  const newSession = useCallback(async (): Promise<void> => {
    const modelId = activeSession?.modelId ?? defaultModelId
    const created = await api.sessions.create(modelId)
    if (!created.ok) return
    let session = created.data
    const temp = await api.workspace.createTemp()
    if (temp.ok) {
      const linked = await api.sessions.setWorkspace(session.id, temp.data.path, true)
      if (linked.ok && linked.data) session = linked.data
    }
    setActiveId(session.id)
    setActiveSession(session)
    const config = await api.settings.get()
    if (config.ok) onSettingsChange(config.data)
    await refreshList(query)
  }, [activeSession, defaultModelId, onSettingsChange, query, refreshList])

  const selectModel = useCallback(
    async (modelId: string): Promise<void> => {
      if (!activeSession) return
      setActiveSession({ ...activeSession, modelId })
      await api.sessions.setModel(activeSession.id, modelId)
    },
    [activeSession]
  )

  const persistUser = useCallback((content: string): void => {
    const id = activeIdRef.current
    if (!id) return
    const message = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content,
      createdAt: Date.now()
    }
    void api.sessions.append(id, message).then((result) => {
      if (!result.ok) return
      if (result.data) setActiveSession(result.data)
      void api.sessions.list().then((list) => {
        if (list.ok) setSessions(list.data)
      })
    })
  }, [])

  const persistAssistant = useCallback(
    (message: {
      content: string
      reasoning?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      finishReason?: string | null
    }): void => {
      const id = activeIdRef.current
      if (!id) return
      const stored = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        createdAt: Date.now(),
        ...message,
        finishReason: message.finishReason ?? null
      }
      void api.sessions.append(id, stored).then((result) => {
        if (!result.ok) return
        if (result.data) setActiveSession(result.data)
        void api.sessions.list().then((list) => {
          if (list.ok) setSessions(list.data)
        })
      })
    },
    []
  )

  const persistTodos = useCallback((todos: TodoItem[]): void => {
    const id = activeIdRef.current
    if (!id) return
    void api.sessions.setTodos(id, todos).then((result) => {
      if (result.ok && result.data) setActiveSession(result.data)
    })
  }, [])

  const performCloseSession = useCallback(
    async (
      id: string,
      action: 'save' | 'delete'
    ): Promise<void> => {
      const current = await api.sessions.get(id)
      const workspacePath = current.ok ? current.data?.workspacePath ?? null : null
      const temporary = current.ok ? current.data?.workspaceTemporary === true : false

      if (temporary && workspacePath) {
        if (action === 'delete') {
          await api.workspace.deleteTemp(workspacePath)
        } else {
          setCloseNotice(`Geçici klasör korundu: ${workspacePath}`)
        }
      }

      await api.sessions.delete(id)
      const list = await refreshList(query)
      if (activeIdRef.current !== id) return

      const next = list?.[0]
      if (next) {
        await openSession(next.id)
      } else {
        const created = await api.sessions.create(defaultModelId)
        if (!created.ok) return
        let session = created.data
        const temp = await api.workspace.createTemp()
        if (temp.ok) {
          const linked = await api.sessions.setWorkspace(session.id, temp.data.path, true)
          if (linked.ok && linked.data) session = linked.data
        }
        setActiveId(session.id)
        setActiveSession(session)
        const config = await api.settings.get()
        if (config.ok) onSettingsChange(config.data)
        await refreshList(query)
      }
    },
    [defaultModelId, onSettingsChange, openSession, query, refreshList]
  )

  const removeSession = useCallback(
    async (id: string): Promise<void> => {
      const current = await api.sessions.get(id)
      const workspacePath = current.ok ? current.data?.workspacePath ?? null : null
      const temporary = current.ok ? current.data?.workspaceTemporary === true : false
      if (temporary && workspacePath) {
        setClosePrompt({
          sessionId: id,
          title: (current.ok ? current.data?.title : null) ?? 'Bu sohbet',
          workspacePath
        })
        return
      }
      await performCloseSession(id, 'delete')
    },
    [performCloseSession]
  )

  const updateSettingsPatch = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      const result = await api.settings.update(patch)
      if (result.ok) onSettingsChange(result.data)
    },
    [onSettingsChange]
  )

  const chooseWorkspace = useCallback(async (): Promise<void> => {
    const result = await api.workspace.choose()
    if (!result.ok || !result.data.path) return
    const id = activeIdRef.current
    if (id) {
      const linked = await api.sessions.setWorkspace(id, result.data.path, false)
      if (linked.ok && linked.data) setActiveSession(linked.data)
    }
    const config = await api.settings.get()
    if (config.ok) onSettingsChange(config.data)
  }, [onSettingsChange])

  const createTempWorkspace = useCallback(async (): Promise<void> => {
    const result = await api.workspace.createTemp()
    if (!result.ok || !result.data.path) return
    const id = activeIdRef.current
    if (id) {
      const linked = await api.sessions.setWorkspace(id, result.data.path, true)
      if (linked.ok && linked.data) setActiveSession(linked.data)
    }
    const config = await api.settings.get()
    if (config.ok) onSettingsChange(config.data)
  }, [onSettingsChange])

  const clearWorkspace = useCallback(async (): Promise<void> => {
    const id = activeIdRef.current
    const result = await api.workspace.clear()
    if (!result.ok) return
    if (id) {
      const linked = await api.sessions.setWorkspace(id, null, false)
      if (linked.ok && linked.data) setActiveSession(linked.data)
    }
    const config = await api.settings.get()
    if (config.ok) onSettingsChange(config.data)
  }, [onSettingsChange])

  const refreshSettings = useCallback(async (): Promise<void> => {
    const config = await api.settings.get()
    if (config.ok) onSettingsChange(config.data)
  }, [onSettingsChange])

  const workspaceName = settings.workspacePath
    ? settings.workspacePath.includes('evren-workspaces')
      ? 'Geçici'
      : settings.workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? settings.workspacePath
    : null

  const cycleTheme = useCallback((): void => {
    const current = settings.theme ?? 'dark'
    const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark'
    void updateSettingsPatch({ theme: next })
  }, [settings.theme, updateSettingsPatch])

  const groupedModels = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const model of chatModels) {
      const list = map.get(model.task) ?? []
      list.push(model)
      map.set(model.task, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [chatModels])

  const activeModel =
    models.find((m) => m.id === activeSession?.modelId) ??
    chatModels.find((m) => m.id === defaultModelId) ??
    null

  const toolsSupported = !!activeModel?.capabilities?.tools
  const agentOptions = {
    enabled: agentEnabled && toolsSupported,
    mode: settings.agentMode ?? ('confirm' as const),
    profile: 'build' as const,
    browser: settings.browserTools ?? true,
    computer: settings.computerTools ?? false,
    workspace: settings.workspaceTools !== false
  }

  const multiverseMembers = useMemo(
    () =>
      chatModels
        .filter((item) => item.id !== activeModel?.id && item.id !== 'auto')
        .map((item) => item.id),
    [chatModels, activeModel?.id]
  )

  const multiverseConfig = useMemo(
    () => ({
      enabled: multiverseEnabled,
      members: multiverseMembers,
      models: chatModels
    }),
    [multiverseEnabled, multiverseMembers, chatModels]
  )

  const dispatchChatCommand = useCallback((command: string): void => {
    window.dispatchEvent(new CustomEvent('evren:command', { detail: command }))
  }, [])

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      {
        id: 'new-chat',
        label: 'Yeni sohbet',
        description: 'Boş bir oturum aç',
        keywords: 'new chat oturum',
        run: () => void newSession()
      },
      {
        id: 'settings',
        label: 'Ayarlar',
        description: 'Bağlantı, anahtar, genel ayarlar',
        keywords: 'settings ayar',
        run: () => setSettingsOpen(true)
      },
      {
        id: 'theme',
        label: 'Temayı değiştir',
        description: 'Koyu / açık / sistem',
        keywords: 'theme tema görünüm',
        run: cycleTheme
      },
      {
        id: 'memory',
        label: 'Hafıza',
        description: 'Anılar ve hafıza ayarları',
        keywords: 'memory hafıza',
        run: () => openSettingsTab('memory')
      },
      {
        id: 'extensions',
        label: 'Uzantılar',
        description: 'MCP, eklenti ve beceriler',
        keywords: 'mcp plugin skill uzantı',
        run: () => openSettingsTab('extensions')
      },
      {
        id: 'scheduled',
        label: 'Zamanlanmış görevler',
        description: 'Tek seferlik / aralıklı / günlük promptlar',
        keywords: 'schedule zamanlanmış görev cron',
        run: () => openSettingsTab('scheduled')
      },
      {
        id: 'github',
        label: 'GitHub hesabı',
        description: 'PAT ile bağlan, profil ve repolar',
        keywords: 'github hesap token repo',
        run: () => openSettingsTab('github')
      },
      {
        id: 'mcp-browser',
        label: 'MCP tarayıcısı',
        description: 'Kaynaklar, promptlar ve görevler',
        keywords: 'mcp resource prompt task kaynak görev',
        run: () => openSettingsTab('mcp')
      },
      {
        id: 'headless-api',
        label: 'Headless API',
        description: 'Yerel HTTP sunucusu, token ve SDK',
        keywords: 'api headless server sdk acp',
        run: () => openSettingsTab('api')
      },
      {
        id: 'workspace-choose',
        label: 'Çalışma alanı seç',
        description: 'Dosya araçları için proje klasörü',
        keywords: 'workspace klasör folder',
        run: () => void chooseWorkspace()
      },
      {
        id: 'toggle-review',
        label: 'İnceleme panelini aç/kapat',
        description: 'Üretilen artifactleri göster',
        keywords: 'review artifact inceleme',
        run: () => dispatchChatCommand('toggle-review')
      },
      {
        id: 'toggle-workspace',
        label: 'Dosyalar panelini aç/kapat',
        description: 'Dosya ağacı, diff ve kontroller',
        keywords: 'files dosya workspace',
        run: () => dispatchChatCommand('toggle-workspace')
      },
      {
        id: 'toggle-git',
        label: 'Git panelini aç/kapat',
        description: 'Status, commit, worktree, PR',
        keywords: 'git commit worktree',
        run: () => dispatchChatCommand('toggle-git')
      },
      {
        id: 'toggle-tasks',
        label: 'Görevler panelini aç/kapat',
        description: 'Todo ve arka plan alt-ajanları',
        keywords: 'tasks todo görev subagent',
        run: () => dispatchChatCommand('toggle-tasks')
      },
      {
        id: 'toggle-terminal',
        label: 'Terminali aç/kapat',
        description: 'PowerShell oturumu ve kodu çalıştır',
        keywords: 'terminal shell komut python',
        run: () => dispatchChatCommand('toggle-terminal')
      },
      {
        id: 'toggle-plan',
        label: 'Plan / Build modunu değiştir',
        description: 'Plan modu salt-okunur çalışır',
        keywords: 'plan build mod',
        run: () => dispatchChatCommand('toggle-plan')
      },
      {
        id: 'focus-composer',
        label: 'Mesaj kutusuna odaklan',
        description: 'Yazmaya devam et',
        keywords: 'focus composer mesaj',
        run: () => dispatchChatCommand('focus-composer')
      }
    ]
    for (const model of chatModels.slice(0, 20)) {
      actions.push({
        id: `model-${model.id}`,
        label: `Model: ${model.id}`,
        description: 'Bu oturumda modeli değiştir',
        keywords: `model ${model.id}`,
        run: () => void selectModel(model.id)
      })
    }
    return actions
  }, [chatModels, chooseWorkspace, cycleTheme, dispatchChatCommand, newSession, openSettingsTab, selectModel])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const control = event.ctrlKey || event.metaKey
      if (control && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen((open) => !open)
        return
      }
      if (control && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void newSession()
        return
      }
      if (control && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (control && event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        dispatchChatCommand('toggle-git')
        return
      }
      if (control && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        dispatchChatCommand('toggle-tasks')
        return
      }
      if (control && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        dispatchChatCommand('toggle-workspace')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dispatchChatCommand, newSession])

  return (
    <div className="workspace">
      <header
        className={`topbar ${isMac ? 'topbar-mac' : ''}`}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('button, select, input, a, .window-controls')) return
          void api.appWindow.toggleMaximize().then((result) => {
            if (result.ok) setMaximized(result.data)
          })
        }}
      >
        <div className="brand">
          <EvrenLogo size={40} className="evren-logo" />
          <div>
            <h1>EVREN Desktop</h1>
            <p>{settings.baseUrl.replace(/^https?:\/\//, '')}</p>
          </div>
        </div>

        <QuotaBar quota={quotaState} now={now} />

        <div className="topbar-right">
          <button
            className="btn-ghost theme-toggle"
            onClick={cycleTheme}
            aria-label={`Tema: ${
              settings.theme === 'light'
                ? 'Açık'
                : settings.theme === 'system'
                  ? 'Sistem'
                  : 'Koyu'
            }`}
            title={`Tema: ${
              settings.theme === 'light'
                ? 'Açık'
                : settings.theme === 'system'
                  ? 'Sistem'
                  : 'Koyu'
            } (tıkla: değiştir)`}
          >
            {settings.theme === 'light' ? '☀' : settings.theme === 'system' ? '◐' : '☾'}
          </button>
          <span className="key-hint" title="Saklanan anahtar">
            {keyStatus?.hint ?? '—'}
            {keyStatus?.source === 'env' && <span className="badge-env">env</span>}
          </span>
          <button className="btn-ghost" onClick={() => setSettingsOpen(true)}>
            Ayarlar
          </button>
          <button className="btn-ghost" onClick={onRefresh}>
            Yenile
          </button>
          <button className="btn-ghost danger" onClick={onSignOut}>
            Anahtarı sil
          </button>
        </div>

        {!isMac && (
          <div className="window-controls">
            <button
              className="window-control"
              onClick={() => void api.appWindow.minimize()}
              title="Küçült"
              aria-label="Küçült"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className="window-control"
              onClick={() =>
                void api.appWindow.toggleMaximize().then((result) => {
                  if (result.ok) setMaximized(result.data)
                })
              }
              title={maximized ? 'Geri yükle' : 'Büyüt'}
              aria-label={maximized ? 'Geri yükle' : 'Büyüt'}
            >
              {maximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <rect
                    x="2.2"
                    y="3.2"
                    width="4.6"
                    height="4.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                  <path
                    d="M3.8 3.2V2.2h4v4H6.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <rect
                    x="2"
                    y="2"
                    width="6"
                    height="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
              )}
            </button>
            <button
              className="window-control window-close"
              onClick={() => void api.appWindow.close()}
              title="Kapat"
              aria-label="Kapat"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M2.2 2.2l5.6 5.6M7.8 2.2L2.2 7.8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
      </header>

      <div className="workspace-body">
        <aside className="sidebar sessions-sidebar">
          <div className="sidebar-head">
            <h2>Sohbetler</h2>
            <button className="btn-new" onClick={() => void newSession()} title="Yeni sohbet">
              +
            </button>
          </div>

          <input
            className="search"
            placeholder="Sohbetlerde ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${activeId === session.id ? 'active' : ''}`}
                onClick={() => void openSession(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void openSession(session.id)
                  }
                }}
              >
                <div className="session-top">
                  <span className="session-title">{session.title}</span>
                  <button
                    className="session-delete"
                    title="Sil"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeSession(session.id)
                    }}
                  >
                    ×
                  </button>
                </div>
                <span className="session-meta">
                  {session.messageCount} mesaj · {formatRelative(session.updatedAt)}
                </span>
                {session.preview && <span className="session-preview">{session.preview}</span>}
              </div>
            ))}
            {sessions.length === 0 && <p className="muted session-empty">Sohbet bulunamadı.</p>}
          </div>
        </aside>

        <main className="content">
          <div className="chat-toolbar">
            <select
              className="model-select"
              value={activeSession?.modelId ?? ''}
              onChange={(e) => void selectModel(e.target.value)}
            >
              {groupedModels.map(([task, list]) => (
                <optgroup key={task} label={TASK_LABELS[task] ?? task}>
                  {list.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {activeModel && (
              <span className="toolbar-meta">
                {formatContext(activeModel.context_length)} bağlam
                {activeModel.precision ? ` · ${activeModel.precision}` : ''}
              </span>
            )}

            <div className="toolbar-spacer" />

            {activeModel && (
              <>
                <button
                  className={`btn-ghost ${settings.workspacePath ? 'active' : ''}`}
                  onClick={() => void chooseWorkspace()}
                  title={
                    settings.workspacePath
                      ? `Çalışma alanı: ${settings.workspacePath}`
                      : 'Dosya araçları için bir proje klasörü seç'
                  }
                >
                  {workspaceName ? `Klasör: ${workspaceName}` : 'Klasör Seç'}
                </button>

                {!settings.workspacePath && (
                  <button
                    className="btn-ghost"
                    onClick={() => void createTempWorkspace()}
                    title="Bu oturum için geçici bir çalışma alanı oluştur"
                  >
                    Geçici Klasör
                  </button>
                )}

                <button
                  className={`btn-ghost ${multiverseEnabled ? 'active' : ''}`}
                  onClick={() => setMultiverseEnabled((enabled) => !enabled)}
                  disabled={multiverseMembers.length === 0}
                  title={
                    multiverseMembers.length === 0
                      ? 'Uygun üye model bulunamadı'
                      : 'Çoklu Evren: tüm uygun modeller + ana model sentezi'
                  }
                >
                  Çoklu Evren
                </button>

                <button
                  className={`btn-ghost ${agentOptions.enabled ? 'active' : ''}`}
                  onClick={() => {
                    const next = !agentEnabled
                    setAgentEnabled(next)
                    if (next && !settings.browserTools && !settings.computerTools) {
                      void updateSettingsPatch({ browserTools: true })
                    }
                    if (!next) setAgentPanelOpen(false)
                  }}
                  disabled={!toolsSupported || multiverseEnabled}
                  title={
                    multiverseEnabled
                      ? 'Çoklu Evren modunda araçlar kullanılmaz'
                      : toolsSupported
                        ? 'Araçları aç/kapat (varsayılan: açık)'
                        : 'Bu model araç çağırmayı desteklemiyor'
                  }
                >
                  Ajan
                </button>

                <div className="params-anchor">
                  <button
                    className={`btn-ghost ${agentPanelOpen ? 'active' : ''}`}
                    onClick={() => setAgentPanelOpen((open) => !open)}
                  >
                    {agentOptions.mode === 'auto' ? 'Oto' : 'Onaylı'}
                  </button>
                  {agentPanelOpen && (
                    <>
                      <div className="params-backdrop" onClick={() => setAgentPanelOpen(false)} />
                      <AgentPanel
                        mode={agentOptions.mode}
                        browser={agentOptions.browser}
                        computer={agentOptions.computer}
                        workspace={agentOptions.workspace}
                        workspacePath={settings.workspacePath ?? null}
                        permissions={settings.permissions ?? {}}
                        hooks={settings.hooks}
                        onChange={(patch) => void updateSettingsPatch(patch)}
                        onChooseWorkspace={() => void chooseWorkspace()}
                        onClearWorkspace={() => void clearWorkspace()}
                      />
                    </>
                  )}
                </div>

                <div className="params-anchor">
                  <button
                    className={`btn-ghost ${paramsOpen ? 'active' : ''}`}
                    onClick={() => setParamsOpen((open) => !open)}
                  >
                    Parametreler
                  </button>
                  {paramsOpen && (
                    <>
                      <div className="params-backdrop" onClick={() => setParamsOpen(false)} />
                      <ParamsPanel
                        model={activeModel}
                        defaults={settings}
                        onChange={(patch) => void updateSettingsPatch(patch)}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {activeModel && activeSession ? (
            <Chat
              model={activeModel}
              sessionId={activeSession.id}
              defaults={settings}
              agent={agentOptions}
              multiverse={multiverseConfig}
              commands={commands}
              summary={activeSession.summary}
              summaryMessageCount={activeSession.summaryMessageCount}
              compaction={
                settings.compaction ?? {
                  auto: true,
                  thresholdPercent: 80,
                  keepTokens: 15000,
                  bufferPercent: 10
                }
              }
              initialMessages={activeSession.messages.map((m) => ({
                role: m.role,
                content: m.content,
                reasoning: m.reasoning
              }))}
              workspacePath={settings.workspacePath ?? null}
              initialTodos={activeSession.todos ?? []}
              onPersistUser={persistUser}
              onPersistAssistant={persistAssistant}
              onQuotaRefresh={() => void refreshQuota()}
              onSessionUpdated={() => void refreshActiveSession()}
              onNewChat={() => void newSession()}
              onOpenSettings={() => openSettingsTab('general')}
              onOpenMemory={() => openSettingsTab('memory')}
              onOpenExtensions={() => openSettingsTab('extensions')}
              onChooseWorkspace={chooseWorkspace}
              onWorkspaceChanged={refreshSettings}
              onTodosChange={persistTodos}
              onSettingsChanged={refreshSettings}
            />
          ) : (
            <p className="muted">Bir sohbet seçin.</p>
          )}
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          keyStatus={keyStatus}
          models={models}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onSaved={onSettingsChange}
          onReload={onRefresh}
        />
      )}

      {closePrompt && (
        <div className="modal-overlay" onClick={() => setClosePrompt(null)}>
          <div
            className="modal close-session-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Sohbeti kapat"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Sohbeti kapat</h2>
              <button className="btn-ghost" onClick={() => setClosePrompt(null)}>
                Kapat
              </button>
            </div>
            <div className="modal-body">
              <p>
                <strong>{closePrompt.title}</strong> sohbetinin geçici çalışma
                klasörü var:
              </p>
              <code className="close-session-path">{closePrompt.workspacePath}</code>
              <p className="muted">
                Klasörü silersen içindeki dosyalar geri alınamaz. Klasörü
                kaydet seçeneği klasörü diskte bırakır.
              </p>
              <div className="inline-actions">
                <button className="btn-ghost" onClick={() => setClosePrompt(null)}>
                  İptal
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const pending = closePrompt
                    setClosePrompt(null)
                    void performCloseSession(pending.sessionId, 'save')
                  }}
                >
                  Klasörü kaydet
                </button>
                <button
                  className="btn-ghost danger"
                  onClick={() => {
                    const pending = closePrompt
                    setClosePrompt(null)
                    void performCloseSession(pending.sessionId, 'delete')
                  }}
                >
                  Klasörü sil
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {closeNotice && (
        <div className="chat-notice" onClick={() => setCloseNotice(null)}>
          {closeNotice}
        </div>
      )}

      <GlobalCommandPalette
        open={commandPaletteOpen}
        actions={paletteActions}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  )
}
