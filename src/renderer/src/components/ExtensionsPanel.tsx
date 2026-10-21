import { useCallback, useEffect, useState } from 'react'
import type {
  DetectedUnit,
  ExtensionType,
  InstalledExtension,
  McpServerStatus,
  PluginStatus,
  RepoInspection
} from '@shared/types'
import { api } from '../lib/ipc'
import { McpConfigEditor } from './McpConfigEditor'

const TABS: Array<{ id: ExtensionType; label: string }> = [
  { id: 'mcp', label: "MCP'ler" },
  { id: 'plugin', label: 'Eklentiler' },
  { id: 'skill', label: 'Beceriler' }
]

const TYPE_LABELS: Record<ExtensionType, string> = {
  mcp: 'MCP',
  plugin: 'Eklenti',
  skill: 'Beceri'
}

const MCP_STATE_LABELS: Record<McpServerStatus['state'], string> = {
  disconnected: 'Bağlı değil',
  connecting: 'Bağlanıyor...',
  connected: 'Bağlı',
  error: 'Hata'
}

const PLUGIN_STATE_LABELS: Record<PluginStatus['state'], string> = {
  unloaded: 'Yüklü değil',
  loading: 'Yükleniyor...',
  loaded: 'Yüklü',
  error: 'Hata'
}

function pluginStateClass(state: PluginStatus['state'] | undefined): string {
  if (state === 'loaded') return 'connected'
  if (state === 'error') return 'error'
  if (state === 'loading') return 'connecting'
  return 'disconnected'
}

function defaultTab(units: DetectedUnit[]): ExtensionType {
  if (units.some((unit) => unit.type === 'skill')) return 'skill'
  if (units.some((unit) => unit.type === 'mcp')) return 'mcp'
  return 'plugin'
}

export function ExtensionsPanel(): React.JSX.Element {
  const [tab, setTab] = useState<ExtensionType>('skill')
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [pluginStatuses, setPluginStatuses] = useState<PluginStatus[]>([])
  const [url, setUrl] = useState('')
  const [inspection, setInspection] = useState<RepoInspection | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<InstalledExtension | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [tokenOpen, setTokenOpen] = useState(false)
  const [tokenStatus, setTokenStatus] = useState<{ hasToken: boolean; hint: string | null } | null>(
    null
  )
  const [tokenInput, setTokenInput] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const result = await api.extensions.list()
    if (result.ok) setInstalled(result.data)
  }, [])

  const refreshToken = useCallback(async (): Promise<void> => {
    const result = await api.github.tokenStatus()
    if (result.ok) setTokenStatus(result.data)
  }, [])

  const refreshStatuses = useCallback(async (): Promise<void> => {
    const [mcpResult, pluginResult] = await Promise.all([
      api.mcp.status(),
      api.plugins.status()
    ])
    if (mcpResult.ok) setStatuses(mcpResult.data)
    if (pluginResult.ok) setPluginStatuses(pluginResult.data)
  }, [])

  useEffect(() => {
    void refresh()
    void refreshToken()
    void refreshStatuses()
  }, [refresh, refreshToken, refreshStatuses])

  async function inspect(): Promise<void> {
    const value = url.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    setMessage(null)
    setInspection(null)
    try {
      const result = await api.extensions.inspect(value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setInspection(result.data)
      setSelected(
        new Set(
          result.data.units
            .filter(
              (unit) =>
                unit.type === 'skill' || unit.type === 'mcp' || unit.type === 'plugin'
            )
            .map((unit) => unit.id)
        )
      )
      setTab(defaultTab(result.data.units))

      const drafts: Record<string, string> = {}
      for (const unit of result.data.units) {
        if (unit.type !== 'mcp') continue
        const details = (unit.details ?? {}) as { command?: string; args?: string[] }
        drafts[unit.id] = [details.command, ...(details.args ?? [])].filter(Boolean).join(' ')
      }
      setCommandDrafts(drafts)
    } finally {
      setBusy(false)
    }
  }

  async function install(): Promise<void> {
    if (!inspection) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const overrides: Record<string, { command: string; args: string[] }> = {}
      for (const [id, value] of Object.entries(commandDrafts)) {
        if (!selected.has(id)) continue
        const parts = value.trim().split(/\s+/).filter(Boolean)
        if (parts.length === 0) continue
        overrides[id] = { command: parts[0], args: parts.slice(1) }
      }

      const result = await api.extensions.install(
        inspection.url,
        [...selected],
        overrides
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMessage(`${result.data.length} uzantı kuruldu.`)
      setInspection(null)
      setUrl('')
      setSelected(new Set())
      setCommandDrafts({})
      await refresh()
      await refreshStatuses()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const result = await api.extensions.remove(id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await api.mcp.disconnect(id)
    await api.plugins.unload(id)
    await refresh()
    await refreshStatuses()
  }

  async function toggle(extension: InstalledExtension): Promise<void> {
    const result = await api.extensions.setEnabled(extension.id, !extension.enabled)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (extension.type === 'mcp' && extension.enabled) {
      await api.mcp.disconnect(extension.id)
    }
    if (extension.type === 'plugin' && extension.enabled) {
      await api.plugins.unload(extension.id)
    }
    await refresh()
    await refreshStatuses()
  }

  async function connectMcp(extension: InstalledExtension): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.mcp.connect(extension.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.data.state === 'error') {
        setError(result.data.error ?? 'MCP sunucusuna bağlanılamadı.')
      }
      await refreshStatuses()
    } finally {
      setBusy(false)
    }
  }

  async function disconnectMcp(id: string): Promise<void> {
    await api.mcp.disconnect(id)
    await refreshStatuses()
  }

  async function loadPlugin(extension: InstalledExtension): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.plugins.load(extension.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.data.state === 'error') {
        setError(result.data.error ?? 'Eklenti yüklenemedi.')
      }
      await refreshStatuses()
    } finally {
      setBusy(false)
    }
  }

  async function unloadPlugin(id: string): Promise<void> {
    await api.plugins.unload(id)
    await refreshStatuses()
  }

  async function saveToken(): Promise<void> {
    if (!tokenInput.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.github.setToken(tokenInput)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTokenInput('')
      await refreshToken()
    } finally {
      setBusy(false)
    }
  }

  async function clearToken(): Promise<void> {
    await api.github.clearToken()
    await refreshToken()
  }

  function toggleSelection(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleInstalled = installed.filter((extension) => extension.type === tab)

  return (
    <div className="extensions">
      <p className="muted extensions-intro">
        Bu sunucuda kullanılabilen uzantıları yönetin. Uzantılar tüm sohbetlerde geçerlidir.
      </p>

      <div className="ext-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span className="ext-tab-count">
              {installed.filter((extension) => extension.type === item.id).length}
            </span>
          </button>
        ))}
      </div>

      <section className="ext-section">
        <h4>GitHub'dan ekle</h4>
        <div className="ext-add-row">
          <input
            type="text"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
          <button className="btn" onClick={() => void inspect()} disabled={busy || !url.trim()}>
            {busy ? 'İnceleniyor...' : 'İncele'}
          </button>
        </div>
        <p className="params-note">
          Repo adresi, dal ve alt dizin desteklenir: <code>github.com/owner/repo#main::path:skills</code>
        </p>

        {error && <p className="error">{error}</p>}
        {message && <p className="ok">{message}</p>}

        {inspection && (
          <div className="inspect-card">
            <div className="inspect-head">
              <div>
                <strong>{inspection.repo}</strong>
                {inspection.description && <p className="muted">{inspection.description}</p>}
              </div>
              <div className="inspect-meta">
                {inspection.license && <span>{inspection.license}</span>}
                {typeof inspection.stars === 'number' && <span>★ {inspection.stars}</span>}
                <span className="mono">{inspection.commit.slice(0, 8)}</span>
              </div>
            </div>

            <div className="unit-list">
              {inspection.units.map((unit) => {
                const available =
                  unit.type === 'skill' || unit.type === 'mcp' || unit.type === 'plugin'
                return (
                  <div key={unit.id} className="unit-wrapper">
                    <label
                      className={`unit-row ${available ? '' : 'unit-disabled'}`}
                      title={available ? undefined : 'E3 aşamasında etkinleşecek'}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(unit.id)}
                        disabled={!available}
                        onChange={() => toggleSelection(unit.id)}
                      />
                      <span className={`unit-badge unit-${unit.type}`}>
                        {TYPE_LABELS[unit.type]}
                      </span>
                      <span className="unit-body">
                        <span className="unit-name">{unit.name}</span>
                        {unit.description && (
                          <span className="unit-desc">{unit.description}</span>
                        )}
                        <span className="unit-path">{unit.path}</span>
                      </span>
                      {!available && <span className="unit-soon">yakında</span>}
                    </label>
                    {unit.type === 'mcp' && available && selected.has(unit.id) && (
                      <div className="unit-command-row">
                        <span>Komut</span>
                        <input
                          value={commandDrafts[unit.id] ?? ''}
                          onChange={(e) =>
                            setCommandDrafts((prev) => ({ ...prev, [unit.id]: e.target.value }))
                          }
                          spellCheck={false}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
              {inspection.units.length === 0 && (
                <p className="muted">Bu repoda tanınan bir uzantı bulunamadı.</p>
              )}
            </div>

            <div className="inspect-actions">
              <button className="btn-ghost" onClick={() => setInspection(null)}>
                Vazgeç
              </button>
              <button
                className="btn"
                onClick={() => void install()}
                disabled={busy || selected.size === 0}
              >
                Seçilenleri kur ({selected.size})
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="ext-section">
        <h4>Tüm sohbetlerde kullanılabilir</h4>
        <div className="installed-list">
          {visibleInstalled.map((extension) => {
            const status = statuses.find((item) => item.id === extension.id)
            const pluginStatus = pluginStatuses.find((item) => item.id === extension.id)
            return (
            <div key={extension.id} className="installed-row">
              <div className="installed-body">
                <div className="installed-top">
                  <span className="unit-name">{extension.name}</span>
                  <span className={`unit-badge unit-${extension.type}`}>
                    {TYPE_LABELS[extension.type]}
                  </span>
                  {extension.version && <span className="installed-version">v{extension.version}</span>}
                </div>
                <span className="installed-source">
                  {extension.source.repo}
                  {extension.source.commit ? ` · ${extension.source.commit.slice(0, 8)}` : ''}
                </span>
                {extension.description && (
                  <span className="installed-desc">{extension.description}</span>
                )}
              </div>
              <div className="installed-actions">
                {extension.type === 'mcp' && (
                  <div className="mcp-controls">
                    <span className={`mcp-state mcp-${status?.state ?? 'disconnected'}`}>
                      {MCP_STATE_LABELS[status?.state ?? 'disconnected']}
                      {status?.state === 'connected' ? ` · ${status.toolCount} araç` : ''}
                      {status?.state === 'connected' && status.resourceCount
                        ? ` · ${status.resourceCount} kaynak`
                        : ''}
                      {status?.state === 'connected' && status.promptCount
                        ? ` · ${status.promptCount} prompt`
                        : ''}
                      {status?.state === 'connected' && status.taskCapable ? ' · görev' : ''}
                    </span>
                    {status?.state === 'connected' ? (
                      <button
                        className="btn-ghost"
                        onClick={() => void disconnectMcp(extension.id)}
                      >
                        Kes
                      </button>
                    ) : (
                      <button
                        className="btn-ghost"
                        onClick={() => void connectMcp(extension)}
                        disabled={busy || !extension.enabled}
                      >
                        Bağlan
                      </button>
                    )}
                    <button className="btn-ghost" onClick={() => setEditing(extension)}>
                      Düzenle
                    </button>
                  </div>
                )}
                {extension.type === 'plugin' && (
                  <div className="mcp-controls">
                    <span
                      className={`mcp-state mcp-${pluginStateClass(pluginStatus?.state)}`}
                    >
                      {PLUGIN_STATE_LABELS[pluginStatus?.state ?? 'unloaded']}
                      {pluginStatus?.state === 'loaded' ? ` · ${pluginStatus.toolCount} araç` : ''}
                    </span>
                    {pluginStatus?.state === 'loaded' ? (
                      <button
                        className="btn-ghost"
                        onClick={() => void unloadPlugin(extension.id)}
                      >
                        Kaldır
                      </button>
                    ) : (
                      <button
                        className="btn-ghost"
                        onClick={() => void loadPlugin(extension)}
                        disabled={busy || !extension.enabled}
                      >
                        Yükle
                      </button>
                    )}
                  </div>
                )}
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={extension.enabled}
                    onChange={() => void toggle(extension)}
                  />
                  <span>{extension.enabled ? 'Etkin' : 'Pasif'}</span>
                </label>
                <button className="btn-ghost danger" onClick={() => void remove(extension.id)}>
                  Kaldır
                </button>
              </div>
            </div>
            )
          })}
          {visibleInstalled.length === 0 && (
            <p className="muted">
              {tab === 'skill' && 'Henüz beceri kurulmadı.'}
              {tab === 'mcp' && "Henüz MCP sunucusu kurulmadı. GitHub'dan ekleyin."}
              {tab === 'plugin' && 'Henüz eklenti kurulmadı.'}
            </p>
          )}
        </div>
      </section>

      <section className="ext-section">
        <button className="ext-token-toggle" onClick={() => setTokenOpen((open) => !open)}>
          GitHub token (opsiyonel) {tokenOpen ? '▴' : '▾'}
        </button>
        {tokenOpen && (
          <div className="ext-token">
            <p className="params-note">
              Private repolar ve daha yüksek API limiti için. Token DPAPI ile şifrelenir.
              {tokenStatus?.hasToken ? ` Kayıtlı: ${tokenStatus.hint}` : ''}
            </p>
            <div className="ext-add-row">
              <input
                type="password"
                placeholder="ghp_..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="btn"
                onClick={() => void saveToken()}
                disabled={busy || !tokenInput.trim()}
              >
                Kaydet
              </button>
              {tokenStatus?.hasToken && (
                <button className="btn-ghost danger" onClick={() => void clearToken()}>
                  Sil
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {editing && (
        <McpConfigEditor
          extension={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void refresh()
            void refreshStatuses()
          }}
        />
      )}
    </div>
  )
}
