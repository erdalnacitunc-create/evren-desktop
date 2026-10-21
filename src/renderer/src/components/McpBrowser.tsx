import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  McpPromptInfo,
  McpPromptResult,
  McpResourceInfo,
  McpServerStatus,
  McpTaskInfo,
  McpToolInfo
} from '@shared/types'
import { api } from '../lib/ipc'

type Tab = 'resources' | 'prompts' | 'tools' | 'tasks'

const TASK_LABELS: Record<string, string> = {
  working: 'Çalışıyor',
  input_required: 'Girdi bekliyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  cancelled: 'İptal edildi'
}

interface Preview {
  title: string
  meta: string
  text: string
  blob: boolean
}

export function McpBrowser(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('resources')
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [resources, setResources] = useState<McpResourceInfo[]>([])
  const [prompts, setPrompts] = useState<McpPromptInfo[]>([])
  const [tools, setTools] = useState<McpToolInfo[]>([])
  const [tasks, setTasks] = useState<McpTaskInfo[]>([])
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<McpPromptInfo | null>(null)
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({})
  const [promptResult, setPromptResult] = useState<McpPromptResult | null>(null)
  const [selectedTool, setSelectedTool] = useState<McpToolInfo | null>(null)
  const [toolArgs, setToolArgs] = useState('{}')
  const [toolTask, setToolTask] = useState(false)
  const [toolResult, setToolResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    const [statusResult, resourceResult, promptResult, taskResult] = await Promise.all([
      api.mcp.status(),
      api.mcp.resources(),
      api.mcp.prompts(),
      api.mcp.tasks()
    ])
    if (statusResult.ok) setStatuses(statusResult.data)
    else setError(statusResult.error)
    if (resourceResult.ok) setResources(resourceResult.data)
    if (promptResult.ok) setPrompts(promptResult.data)
    if (taskResult.ok) setTasks(taskResult.data)
    const toolResult = await api.mcp.tools()
    if (toolResult.ok) setTools(toolResult.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (tab !== 'tasks') return
    const timer = window.setInterval(async () => {
      const result = await api.mcp.tasks()
      if (result.ok) setTasks(result.data)
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [tab])

  const connected = useMemo(
    () => statuses.filter((status) => status.state === 'connected'),
    [statuses]
  )

  const filteredResources = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return resources
    return resources.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.uri.toLowerCase().includes(needle) ||
        item.serverName.toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle)
    )
  }, [query, resources])

  const filteredPrompts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return prompts
    return prompts.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.title ?? '').toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle) ||
        item.serverName.toLowerCase().includes(needle)
    )
  }, [prompts, query])

  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return tools
    return tools.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle) ||
        item.serverName.toLowerCase().includes(needle)
    )
  }, [tools, query])

  const readResource = useCallback(async (item: McpResourceInfo): Promise<void> => {
    let uri = item.uri
    if (item.template) {
      const value = window.prompt('Kaynak URI değerini girin:', item.uriTemplate ?? '')
      if (!value) return
      uri = value.trim()
    }
    setBusy(true)
    setError(null)
    setPreview({
      title: item.name,
      meta: `${item.serverName} · ${uri}`,
      text: 'Okunuyor...',
      blob: false
    })
    try {
      const result = await api.mcp.readResource(item.serverId, uri)
      if (!result.ok) {
        setError(result.error)
        setPreview(null)
        return
      }
      const contents = result.data
      const text = contents
        .map((content) => {
          if (content.text !== undefined) return content.text
          if (content.blob !== undefined) return '[ikili içerik]'
          return '(boş)'
        })
        .join('\n\n')
      setPreview({
        title: item.name,
        meta: `${item.serverName} · ${contents[0]?.mimeType ?? item.mimeType ?? 'bilinmiyor'}${
          contents.some((content) => content.truncated) ? ' · kısaltıldı' : ''
        }`,
        text: text || '(boş kaynak)',
        blob: contents.every((content) => content.text === undefined)
      })
    } finally {
      setBusy(false)
    }
  }, [])

  const selectPrompt = useCallback((prompt: McpPromptInfo): void => {
    setSelectedPrompt(prompt)
    setPromptResult(null)
    const args: Record<string, string> = {}
    for (const argument of prompt.arguments) args[argument.name] = ''
    setPromptArgs(args)
    setPreview(null)
  }, [])

  const loadPrompt = useCallback(async (): Promise<void> => {
    if (!selectedPrompt) return
    setBusy(true)
    setError(null)
    setPromptResult(null)
    try {
      const result = await api.mcp.getPrompt(
        selectedPrompt.serverId,
        selectedPrompt.name,
        promptArgs
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPromptResult(result.data)
    } finally {
      setBusy(false)
    }
  }, [promptArgs, selectedPrompt])

  const selectTool = useCallback((tool: McpToolInfo): void => {
    setSelectedTool(tool)
    setToolTask(false)
    setToolResult(null)
    setPreview(null)
    const schema = tool.inputSchema as
      | { properties?: Record<string, { type?: string; default?: unknown }> }
      | undefined
    const sample: Record<string, unknown> = {}
    for (const [name, property] of Object.entries(schema?.properties ?? {})) {
      if (property.default !== undefined) sample[name] = property.default
      else if (property.type === 'number' || property.type === 'integer') sample[name] = 0
      else if (property.type === 'boolean') sample[name] = false
      else if (property.type === 'array') sample[name] = []
      else if (property.type === 'object') sample[name] = {}
      else sample[name] = ''
    }
    setToolArgs(JSON.stringify(sample, null, 2))
  }, [])

  const runTool = useCallback(async (): Promise<void> => {
    if (!selectedTool) return
    setError(null)
    setToolResult(null)
    let parsed: Record<string, unknown>
    try {
      const value = JSON.parse(toolArgs || '{}') as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Argümanlar bir JSON nesnesi olmalı.')
      }
      parsed = value as Record<string, unknown>
    } catch (error) {
      setError(`JSON hatası: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setBusy(true)
    setPreview(null)
    try {
      const result = await api.mcp.callTool(
        selectedTool.serverId,
        selectedTool.name,
        parsed,
        selectedTool.taskCapable && toolTask
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setToolResult(result.data.content)
      if (result.data.task) {
        setNotice(`Görev oluşturuldu: ${result.data.task.taskId}`)
        const list = await api.mcp.tasks()
        if (list.ok) setTasks(list.data)
      }
    } finally {
      setBusy(false)
    }
  }, [selectedTool, toolArgs, toolTask])

  const copyText = useCallback(async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Panoya kopyalandı.')
    } catch {
      setError('Panoya kopyalanamadı.')
    }
  }, [])

  const insertText = useCallback((text: string): void => {
    if (!text.trim()) return
    window.dispatchEvent(new CustomEvent('evren:insert-input', { detail: text }))
    setNotice("Composer'a eklendi. Ayarlar penceresini kapatıp gönderebilirsiniz.")
  }, [])

  const cancelTask = useCallback(
    async (task: McpTaskInfo): Promise<void> => {
      if (!window.confirm(`"${task.taskId}" görevi iptal edilsin mi?`)) return
      setBusy(true)
      try {
        const result = await api.mcp.cancelTask(task.serverId, task.taskId)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setNotice('Görev iptal edildi.')
        const list = await api.mcp.tasks()
        if (list.ok) setTasks(list.data)
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const showTaskResult = useCallback(async (task: McpTaskInfo): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.mcp.taskResult(task.serverId, task.taskId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (!result.data.ok) {
        setError(result.data.content)
        return
      }
      setPreview({
        title: `Görev sonucu: ${task.taskId}`,
        meta: `${task.serverName} · ${TASK_LABELS[task.status] ?? task.status}`,
        text: result.data.content,
        blob: false
      })
    } finally {
      setBusy(false)
    }
  }, [])

  if (loading) return <p className="muted">MCP sunucuları yükleniyor...</p>

  const promptText = promptResult?.messages
    .map((message) => `${message.role === 'assistant' ? 'Asistan' : 'Kullanıcı'}:\n${message.text}`)
    .join('\n\n')

  return (
    <div className="mcp-browser">
      <div className="mcp-browser-head">
        <div>
          <h4>MCP tarayıcısı</h4>
          <p className="muted mcp-browser-hint">
            Bağlı sunucuların kaynaklarını okuyun, promptlarını getirin ve görevlerini yönetin.
          </p>
        </div>
        <button className="btn-ghost" onClick={() => void refresh()} disabled={busy}>
          Yenile
        </button>
      </div>

      <div className="mcp-server-strip">
        {connected.length === 0 ? (
          <span className="muted">
            Bağlı MCP sunucusu yok. <strong>Uzantılar</strong> sekmesinden bir MCP bağlayın.
          </span>
        ) : (
          connected.map((server) => (
            <span className="mcp-server-chip" key={server.id}>
              {server.name}
              <small>
                {server.toolCount} araç · {server.resourceCount ?? 0} kaynak ·{' '}
                {server.promptCount ?? 0} prompt
                {server.taskCapable ? ' · görev' : ''}
              </small>
            </span>
          ))
        )}
      </div>

      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      <div className="mcp-browser-tabs">
        <button
          className={tab === 'resources' ? 'active' : ''}
          onClick={() => {
            setTab('resources')
            setQuery('')
          }}
        >
          Kaynaklar ({resources.length})
        </button>
        <button
          className={tab === 'prompts' ? 'active' : ''}
          onClick={() => {
            setTab('prompts')
            setQuery('')
          }}
        >
          Promptlar ({prompts.length})
        </button>
        <button
          className={tab === 'tools' ? 'active' : ''}
          onClick={() => {
            setTab('tools')
            setQuery('')
          }}
        >
          Araçlar ({tools.length})
        </button>
        <button
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => {
            setTab('tasks')
            setQuery('')
          }}
        >
          Görevler ({tasks.length})
        </button>
      </div>

      {tab !== 'tasks' && (
        <input
          className="search mcp-browser-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            tab === 'resources' ? 'Kaynak ara...' : tab === 'prompts' ? 'Prompt ara...' : 'Araç ara...'
          }
        />
      )}

      {tab === 'resources' && (
        <div className="mcp-browser-split">
          <div className="mcp-list">
            {filteredResources.length === 0 ? (
              <p className="muted">Kaynak bulunamadı.</p>
            ) : (
              filteredResources.map((item) => (
                <button
                  className={`mcp-item ${
                    preview?.title === item.name ? 'active' : ''
                  }`}
                  key={`${item.serverId}:${item.uri}`}
                  onClick={() => void readResource(item)}
                  disabled={busy}
                >
                  <span className="mcp-item-title">
                    {item.name}
                    {item.template && <span className="mcp-badge">şablon</span>}
                  </span>
                  <span className="mcp-item-sub">{item.serverName}</span>
                  <span className="mcp-item-uri">{item.uri}</span>
                  {item.description && (
                    <span className="mcp-item-desc">{item.description}</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="mcp-preview">
            {preview ? (
              <>
                <div className="mcp-preview-head">
                  <div>
                    <strong>{preview.title}</strong>
                    <span className="muted">{preview.meta}</span>
                  </div>
                  <div className="mcp-preview-actions">
                    <button
                      className="btn-ghost"
                      onClick={() => void copyText(preview.text)}
                      disabled={preview.blob}
                    >
                      Kopyala
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => insertText(preview.text)}
                      disabled={preview.blob}
                    >
                      Composer'a ekle
                    </button>
                  </div>
                </div>
                {preview.blob ? (
                  <p className="muted">
                    İkili kaynak önizlenemiyor. Kaynağı bir araçla okumak için ajanı kullanın.
                  </p>
                ) : (
                  <pre className="mcp-preview-text">{preview.text}</pre>
                )}
              </>
            ) : (
              <p className="muted">Okumak için soldan bir kaynak seçin.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'prompts' && (
        <div className="mcp-browser-split">
          <div className="mcp-list">
            {filteredPrompts.length === 0 ? (
              <p className="muted">Prompt bulunamadı.</p>
            ) : (
              filteredPrompts.map((prompt) => (
                <button
                  className={`mcp-item ${
                    selectedPrompt?.serverId === prompt.serverId &&
                    selectedPrompt.name === prompt.name
                      ? 'active'
                      : ''
                  }`}
                  key={`${prompt.serverId}:${prompt.name}`}
                  onClick={() => selectPrompt(prompt)}
                >
                  <span className="mcp-item-title">{prompt.title || prompt.name}</span>
                  <span className="mcp-item-sub">{prompt.serverName}</span>
                  {prompt.description && (
                    <span className="mcp-item-desc">{prompt.description}</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="mcp-preview">
            {selectedPrompt ? (
              <>
                <div className="mcp-preview-head">
                  <div>
                    <strong>{selectedPrompt.title || selectedPrompt.name}</strong>
                    <span className="muted">{selectedPrompt.serverName}</span>
                  </div>
                </div>
                {selectedPrompt.arguments.length > 0 && (
                  <div className="mcp-prompt-args">
                    {selectedPrompt.arguments.map((argument) => (
                      <label className="field" key={argument.name}>
                        <span>
                          {argument.name}
                          {argument.required ? ' *' : ''}
                        </span>
                        {argument.description && (
                          <small className="muted">{argument.description}</small>
                        )}
                        <input
                          value={promptArgs[argument.name] ?? ''}
                          onChange={(event) =>
                            setPromptArgs((current) => ({
                              ...current,
                              [argument.name]: event.target.value
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="mcp-preview-actions">
                  <button className="btn" onClick={() => void loadPrompt()} disabled={busy}>
                    Promptu getir
                  </button>
                  {promptResult && promptText && (
                    <>
                      <button
                        className="btn-ghost"
                        onClick={() => void copyText(promptText)}
                      >
                        Kopyala
                      </button>
                      <button className="btn-ghost" onClick={() => insertText(promptText)}>
                        Composer'a ekle
                      </button>
                    </>
                  )}
                </div>
                {promptResult?.description && (
                  <p className="muted">{promptResult.description}</p>
                )}
                {promptText && <pre className="mcp-preview-text">{promptText}</pre>}
              </>
            ) : (
              <p className="muted">Getirmek için soldan bir prompt seçin.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'tools' && (
        <div className="mcp-browser-split">
          <div className="mcp-list">
            {filteredTools.length === 0 ? (
              <p className="muted">Araç bulunamadı.</p>
            ) : (
              filteredTools.map((tool) => (
                <button
                  className={`mcp-item ${
                    selectedTool?.serverId === tool.serverId &&
                    selectedTool.name === tool.name
                      ? 'active'
                      : ''
                  }`}
                  key={`${tool.serverId}:${tool.name}`}
                  onClick={() => selectTool(tool)}
                >
                  <span className="mcp-item-title">
                    {tool.name}
                    {tool.taskCapable && <span className="mcp-badge">görev</span>}
                  </span>
                  <span className="mcp-item-sub">{tool.serverName}</span>
                  {tool.description && (
                    <span className="mcp-item-desc">{tool.description}</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="mcp-preview">
            {selectedTool ? (
              <>
                <div className="mcp-preview-head">
                  <div>
                    <strong>{selectedTool.name}</strong>
                    <span className="muted">{selectedTool.serverName}</span>
                  </div>
                </div>
                {selectedTool.description && (
                  <p className="muted">{selectedTool.description}</p>
                )}
                <label className="field">
                  <span>Argümanlar (JSON)</span>
                  <textarea
                    className="mcp-tool-args"
                    rows={7}
                    value={toolArgs}
                    onChange={(event) => setToolArgs(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                {selectedTool.taskCapable && (
                  <label className="mcp-checkbox">
                    <input
                      type="checkbox"
                      checked={toolTask}
                      onChange={(event) => setToolTask(event.target.checked)}
                    />
                    <span>Uzun iş olarak MCP görevi başlat</span>
                  </label>
                )}
                <div className="mcp-preview-actions">
                  <button className="btn" onClick={() => void runTool()} disabled={busy}>
                    {busy ? 'Çalışıyor...' : 'Aracı çalıştır'}
                  </button>
                  {toolResult && (
                    <button
                      className="btn-ghost"
                      onClick={() => void copyText(toolResult)}
                    >
                      Kopyala
                    </button>
                  )}
                </div>
                {toolResult && <pre className="mcp-preview-text">{toolResult}</pre>}
              </>
            ) : (
              <p className="muted">Çalıştırmak için soldan bir araç seçin.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <>
          <div className="mcp-task-list">
            {tasks.length === 0 ? (
              <p className="muted">
                Görev yok. Görev destekli MCP sunucularında uzun işler burada görünür.
              </p>
            ) : (
              tasks.map((task) => (
                <div className="mcp-task" key={`${task.serverId}:${task.taskId}`}>
                  <div className="mcp-task-main">
                    <strong>{task.taskId}</strong>
                    <span className={`mcp-task-status ${task.status}`}>
                      {TASK_LABELS[task.status] ?? task.status}
                    </span>
                    <span className="muted">{task.serverName}</span>
                    {task.statusMessage && (
                      <span className="mcp-item-desc">{task.statusMessage}</span>
                    )}
                    <span className="mcp-item-uri">
                      {task.lastUpdatedAt
                        ? new Date(task.lastUpdatedAt).toLocaleString('tr-TR')
                        : ''}
                    </span>
                  </div>
                  <div className="mcp-preview-actions">
                    <button
                      className="btn-ghost"
                      onClick={() => void showTaskResult(task)}
                      disabled={busy}
                    >
                      Sonuç
                    </button>
                    {(task.status === 'working' || task.status === 'input_required') && (
                      <button
                        className="btn-ghost danger"
                        onClick={() => void cancelTask(task)}
                        disabled={busy}
                      >
                        İptal
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {preview && (
            <div className="mcp-preview mcp-task-preview">
              <div className="mcp-preview-head">
                <div>
                  <strong>{preview.title}</strong>
                  <span className="muted">{preview.meta}</span>
                </div>
                <button className="btn-ghost" onClick={() => void copyText(preview.text)}>
                  Kopyala
                </button>
              </div>
              <pre className="mcp-preview-text">{preview.text}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
