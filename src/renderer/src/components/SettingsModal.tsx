import { useState } from 'react'
import type { AppSettings, KeyStatus, Locale, ModelInfo, ThemeMode } from '@shared/types'
import { api } from '../lib/ipc'
import { LOCALES, LOCALE_LABELS, useI18n } from '../i18n'
import { ExtensionsPanel } from './ExtensionsPanel'
import { GithubAccountPanel } from './GithubAccountPanel'
import { HeadlessPanel } from './HeadlessPanel'
import { McpBrowser } from './McpBrowser'
import { MemoryPanel } from './MemoryPanel'
import { ReferencesPanel } from './ReferencesPanel'
import { ScheduledTasksPanel } from './ScheduledTasksPanel'
import { UpdatePanel } from './UpdatePanel'

interface Props {
  settings: AppSettings
  keyStatus: KeyStatus | null
  models: ModelInfo[]
  initialTab?:
    | 'general'
    | 'extensions'
    | 'memory'
    | 'references'
    | 'github'
    | 'scheduled'
    | 'mcp'
    | 'api'
  onClose: () => void
  onSaved: (settings: AppSettings) => void
  onReload: () => void
}

const DEFAULT_BASE_URL = 'https://evren-llmapi.ssyz.org.tr'

export function SettingsModal({
  settings,
  keyStatus,
  models,
  initialTab,
  onClose,
  onSaved,
  onReload
}: Props): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMessage, setOkMessage] = useState<string | null>(null)
  const [tab, setTab] = useState<
    | 'general'
    | 'extensions'
    | 'memory'
    | 'references'
    | 'github'
    | 'scheduled'
    | 'mcp'
    | 'api'
  >(initialTab ?? 'general')
  const { t } = useI18n()

  async function saveBaseUrl(): Promise<void> {
    setBusy(true)
    setError(null)
    setOkMessage(null)
    try {
      const result = await api.settings.update({ baseUrl })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.data)
      setOkMessage('Adres kaydedildi. Modeller yeniden yükleniyor...')
      onReload()
    } finally {
      setBusy(false)
    }
  }

  async function saveKey(): Promise<void> {
    const key = keyInput.trim()
    if (!key) return
    setBusy(true)
    setError(null)
    setOkMessage(null)
    try {
      const validation = await api.key.validate(key)
      if (!validation.ok) {
        setError(validation.error)
        return
      }
      const saved = await api.key.save(key)
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      setKeyInput('')
      setOkMessage(`Anahtar doğrulandı — ${validation.data.length} model bulundu.`)
      onReload()
    } finally {
      setBusy(false)
    }
  }

  async function clearKey(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.key.clear()
      onReload()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function openLogs(): Promise<void> {
    const result = await api.app.openLogs()
    if (!result.ok) setError(result.error)
  }

  async function saveLocale(next: Locale): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.settings.update({ locale: next })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.data)
    } finally {
      setBusy(false)
    }
  }

  async function saveTheme(theme: ThemeMode): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.settings.update({ theme })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.data)
    } finally {
      setBusy(false)
    }
  }

  async function saveSubagents(autoResume: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.settings.update({ subagents: { autoResume } })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ${tab !== 'general' ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{t('settings.title')}</h2>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={tab === 'general' ? 'active' : ''}
            onClick={() => setTab('general')}
          >
            {t('settings.tab.general')}
          </button>
          <button
            className={tab === 'extensions' ? 'active' : ''}
            onClick={() => setTab('extensions')}
          >
            {t('settings.tab.extensions')}
          </button>
          <button
            className={tab === 'memory' ? 'active' : ''}
            onClick={() => setTab('memory')}
          >
            {t('settings.tab.memory')}
          </button>
          <button
            className={tab === 'references' ? 'active' : ''}
            onClick={() => setTab('references')}
          >
            {t('settings.tab.references')}
          </button>
          <button
            className={tab === 'github' ? 'active' : ''}
            onClick={() => setTab('github')}
          >
            GitHub
          </button>
          <button
            className={tab === 'scheduled' ? 'active' : ''}
            onClick={() => setTab('scheduled')}
          >
            {t('settings.tab.scheduled')}
          </button>
          <button className={tab === 'mcp' ? 'active' : ''} onClick={() => setTab('mcp')}>
            MCP
          </button>
          <button className={tab === 'api' ? 'active' : ''} onClick={() => setTab('api')}>
            API
          </button>
        </div>

        <div className="modal-body">
          {tab === 'extensions' ? (
            <ExtensionsPanel />
          ) : tab === 'memory' ? (
            <MemoryPanel settings={settings} models={models} onSaved={onSaved} />
          ) : tab === 'references' ? (
            <ReferencesPanel settings={settings} onSaved={onSaved} />
          ) : tab === 'github' ? (
            <GithubAccountPanel settings={settings} onSaved={onSaved} />
          ) : tab === 'scheduled' ? (
            <ScheduledTasksPanel models={models} />
          ) : tab === 'mcp' ? (
            <McpBrowser />
          ) : tab === 'api' ? (
            <HeadlessPanel settings={settings} onSaved={onSaved} />
          ) : (
            <>
          <section className="settings-section">
            <h3>{t('settings.connection')}</h3>
            <label className="field">
              <span>{t('settings.serverUrl')}</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <div className="inline-actions">
              <button
                className="btn-ghost"
                onClick={() => setBaseUrl(DEFAULT_BASE_URL)}
                disabled={busy}
              >
                {t('settings.resetDefaultUrl')}
              </button>
              <button className="btn" onClick={() => void saveBaseUrl()} disabled={busy}>
                {t('common.save')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>{t('settings.appearance')}</h3>
            <div className="segmented">
              {(['dark', 'light', 'system'] as ThemeMode[]).map((theme) => (
                <button
                  key={theme}
                  className={`${(settings.theme ?? 'dark') === theme ? 'active' : ''}`}
                  onClick={() => void saveTheme(theme)}
                  disabled={busy}
                >
                  {theme === 'dark'
                    ? t('settings.theme.dark')
                    : theme === 'light'
                      ? t('settings.theme.light')
                      : t('settings.theme.system')}
                </button>
              ))}
            </div>
            <p className="params-note">{t('settings.theme.note')}</p>
          </section>

          <section className="settings-section">
            <h3>{t('settings.language')}</h3>
            <div className="segmented">
              {LOCALES.map((locale) => (
                <button
                  key={locale}
                  className={`${(settings.locale ?? 'tr') === locale ? 'active' : ''}`}
                  onClick={() => void saveLocale(locale)}
                  disabled={busy}
                >
                  {LOCALE_LABELS[locale]}
                </button>
              ))}
            </div>
            <p className="params-note">{t('settings.language.note')}</p>
          </section>

          <section className="settings-section">
            <h3>{t('settings.apiKey')}</h3>
            <p className="muted">
              {t('settings.storedKey')} <code>{keyStatus?.hint ?? '—'}</code>
              {keyStatus?.source === 'env' && ` ${t('settings.fromEnv')}`}
            </p>
            <label className="field">
              <span>{t('settings.newKey')}</span>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="evren_..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="inline-actions">
              <button
                className="btn-ghost danger"
                onClick={() => void clearKey()}
                disabled={busy}
              >
                {t('settings.deleteKey')}
              </button>
              <button
                className="btn"
                onClick={() => void saveKey()}
                disabled={busy || !keyInput.trim()}
              >
                {t('settings.validateAndSave')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>{t('update.title')}</h3>
            <UpdatePanel />
          </section>

          <section className="settings-section">
            <h3>{t('settings.logs')}</h3>
            <p className="muted">{t('settings.logs.note')}</p>
            <div className="inline-actions">
              <button className="btn-ghost" onClick={() => void openLogs()}>
                {t('settings.openLogFolder')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Alt-ajanlar</h3>
            <label className="mcp-checkbox">
              <input
                type="checkbox"
                checked={settings.subagents?.autoResume === true}
                disabled={busy}
                onChange={(event) => void saveSubagents(event.target.checked)}
              />
              <span>Kesilen alt-ajan görevlerini açılışta otomatik sürdür</span>
            </label>
            <p className="muted">
              Uygulama kapanırken çalışan arka plan görevleri <code>interrupted</code> olarak
              işaretlenir. Bu seçenek açıksa en fazla 2 kez otomatik yeniden denenir. Onay
              gerektiren araç çağrıları otomatik kabul edilir; yalnızca açık “engelle”
              politikası engeller.
            </p>
          </section>

          <section className="settings-section">
            <h3>Gizlilik</h3>
            <p className="muted">
              Anahtar Windows DPAPI ile şifrelenir ve yalnızca ana süreçte tutulur.
              Sohbetler yerel olarak <code>sessions.json</code> içinde saklanır; dışarıya
              gönderilmez.
            </p>
          </section>

          {error && <p className="error">{error}</p>}
          {okMessage && <p className="ok">{okMessage}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
