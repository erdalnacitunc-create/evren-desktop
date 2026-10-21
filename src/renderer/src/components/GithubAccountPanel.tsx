import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, GithubAccount, GithubDeviceCode, GithubRepo } from '@shared/types'
import { api } from '../lib/ipc'
import { GithubAppPanel } from './GithubAppPanel'

interface Props {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
}

export function GithubAccountPanel({ settings, onSaved }: Props): React.JSX.Element {
  const [account, setAccount] = useState<GithubAccount | null>(null)
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [mode, setMode] = useState<'device' | 'pat'>('device')
  const [clientId, setClientId] = useState(settings.githubOAuthClientId ?? '')
  const [device, setDevice] = useState<GithubDeviceCode | null>(null)
  const [deviceWaiting, setDeviceWaiting] = useState(false)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pollTimer = useRef<number | null>(null)
  const pollSeq = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    const accountResult = await api.github.account()
    if (!accountResult.ok) {
      setError(accountResult.error)
      setLoading(false)
      return
    }
    setAccount(accountResult.data)
    if (accountResult.data.connected) {
      const repoResult = await api.github.repos()
      if (repoResult.ok) setRepos(repoResult.data)
      else setError(repoResult.error)
    } else {
      setRepos([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connect = useCallback(async (): Promise<void> => {
    const value = token.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.github.connect(value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAccount(result.data)
      setToken('')
      setNotice('GitHub hesabı bağlandı.')
      const repoResult = await api.github.repos()
      if (repoResult.ok) setRepos(repoResult.data)
    } finally {
      setBusy(false)
    }
  }, [token])

  const disconnect = useCallback(async (): Promise<void> => {
    if (!window.confirm('GitHub hesabı bağlantısı kesilsin mi? Kayıtlı token silinecek.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.github.disconnect()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAccount({ connected: false })
      setRepos([])
      setNotice('GitHub bağlantısı kesildi.')
    } finally {
      setBusy(false)
    }
  }, [])

  const openRepo = useCallback(async (url: string): Promise<void> => {
    if (!url) return
    const result = await api.app.openExternal(url)
    if (!result.ok) setError(result.error)
  }, [])

  const openTokens = useCallback(async (): Promise<void> => {
    const result = await api.app.openExternal('https://github.com/settings/tokens')
    if (!result.ok) setError(result.error)
  }, [])

  const openOAuthApps = useCallback(async (): Promise<void> => {
    const result = await api.app.openExternal('https://github.com/settings/developers')
    if (!result.ok) setError(result.error)
  }, [])

  const stopPolling = useCallback((): void => {
    pollSeq.current += 1
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
    setDeviceWaiting(false)
  }, [])

  useEffect(() => {
    return () => {
      pollSeq.current += 1
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    }
  }, [])

  const schedulePoll = useCallback(
    (id: string, code: string, delaySeconds: number): void => {
      const sequence = pollSeq.current
      const delay = Math.max(2, delaySeconds)
      const tick = async (): Promise<void> => {
        if (sequence !== pollSeq.current) return
        const result = await api.github.devicePoll(id, code)
        if (sequence !== pollSeq.current) return
        if (!result.ok) {
          setDeviceError(result.error)
          setDeviceWaiting(false)
          return
        }
        if (result.data.status === 'pending') {
          pollTimer.current = window.setTimeout(() => void tick(), delay * 1000)
          return
        }
        if (result.data.status === 'slow_down') {
          pollTimer.current = window.setTimeout(
            () => void tick(),
            Math.max(2, result.data.interval) * 1000
          )
          return
        }
        if (result.data.status === 'success') {
          const connected = result.data.account
          setAccount(connected)
          setDevice(null)
          setDeviceWaiting(false)
          setDeviceError(null)
          setNotice('GitHub hesabı bağlandı.')
          const repoResult = await api.github.repos()
          if (repoResult.ok) setRepos(repoResult.data)
          return
        }
        setDeviceError(result.data.error)
        setDeviceWaiting(false)
      }
      pollTimer.current = window.setTimeout(() => void tick(), delay * 1000)
    },
    []
  )

  const startDevice = useCallback(async (): Promise<void> => {
    const id = clientId.trim()
    if (!id) {
      setDeviceError('Önce GitHub OAuth App Client ID girin.')
      return
    }
    stopPolling()
    setDeviceError(null)
    setNotice(null)
    setBusy(true)
    try {
      const saved = await api.settings.update({ githubOAuthClientId: id })
      if (saved.ok) onSaved(saved.data)
      const result = await api.github.deviceStart(id)
      if (!result.ok) {
        setDeviceError(result.error)
        return
      }
      setDevice(result.data)
      setDeviceWaiting(true)
      pollSeq.current += 1
      await api.app.openExternal(result.data.verificationUri)
      schedulePoll(id, result.data.deviceCode, result.data.interval)
    } finally {
      setBusy(false)
    }
  }, [clientId, onSaved, schedulePoll, stopPolling])

  const cancelDevice = useCallback((): void => {
    stopPolling()
    setDevice(null)
    setDeviceError(null)
  }, [stopPolling])

  const copyDeviceCode = useCallback(async (): Promise<void> => {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.userCode)
      setNotice('Kod panoya kopyalandı.')
    } catch {
      setDeviceError('Kod panoya kopyalanamadı.')
    }
  }, [device])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (needle
      ? repos.filter(
          (repo) =>
            repo.fullName.toLowerCase().includes(needle) ||
            (repo.description ?? '').toLowerCase().includes(needle)
        )
      : repos
    ).slice(0, 60)
  }, [query, repos])

  if (loading) return <p className="muted">GitHub hesabı kontrol ediliyor...</p>

  return (
    <div className="github-account">
      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      {!account?.connected ? (
        <div className="gh-connect">
          <div className="gh-auth-tabs">
            <button
              className={mode === 'device' ? 'active' : ''}
              onClick={() => setMode('device')}
            >
              Tarayıcı ile giriş
            </button>
            <button className={mode === 'pat' ? 'active' : ''} onClick={() => setMode('pat')}>
              PAT
            </button>
          </div>

          {mode === 'device' ? (
            <>
              <h4>GitHub ile giriş</h4>
              <p className="muted">
                Kendi GitHub OAuth App’inizin Client ID’si ile cihaz akışı. Token yalnızca
                ana süreçte DPAPI ile saklanır.
              </p>
              <label className="field">
                <span>OAuth App Client ID</span>
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="Ov23li..."
                  spellCheck={false}
                  autoComplete="off"
                  disabled={deviceWaiting}
                />
              </label>
              <button className="btn-ghost gh-token-link" onClick={() => void openOAuthApps()}>
                GitHub OAuth Apps oluştur / yönet
              </button>
              <p className="muted gh-device-help">
                OAuth App ayarlarında <strong>Enable Device Flow</strong> işaretli olmalı.
                Callback URL olarak <code>http://127.0.0.1</code> kullanabilirsiniz.
              </p>

              {deviceError && <div className="ws-error">{deviceError}</div>}

              {device ? (
                <div className="gh-device-code">
                  <span className="muted">Tarayıcıda bu kodu girin:</span>
                  <strong>{device.userCode}</strong>
                  <div className="gh-device-actions">
                    <button className="btn-ghost" onClick={() => void copyDeviceCode()}>
                      Kodu kopyala
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => void openRepo(device.verificationUri)}
                    >
                      Tarayıcıyı aç
                    </button>
                    <button className="btn-ghost danger" onClick={cancelDevice}>
                      İptal
                    </button>
                  </div>
                  <p className="muted">
                    {deviceWaiting
                      ? 'Onay bekleniyor... Bu pencereyi kapatmayın.'
                      : 'Akış durduruldu.'}
                  </p>
                  <code>{device.verificationUri}</code>
                </div>
              ) : (
                <div className="gh-token-row">
                  <button
                    className="btn"
                    onClick={() => void startDevice()}
                    disabled={busy || !clientId.trim()}
                  >
                    {busy ? 'Kod alınıyor...' : 'Kodla giriş yap'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <h4>Kişisel erişim token’ı</h4>
              <p className="muted">
                PAT ile bağlanın. Token yalnızca ana süreçte DPAPI ile saklanır; renderer’a
                geri verilmez.
              </p>
              <p className="muted">
                Gerekli kapsamlar: <code>read:user</code>, <code>repo</code>,{' '}
                <code>read:org</code>, <code>workflow</code>.
              </p>
              <div className="gh-token-row">
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_... veya github_pat_..."
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void connect()
                  }}
                />
                <button
                  className="btn"
                  onClick={() => void connect()}
                  disabled={busy || !token.trim()}
                >
                  Bağlan
                </button>
              </div>
              <button className="btn-ghost gh-token-link" onClick={() => void openTokens()}>
                GitHub token oluştur
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="gh-profile">
            {account.user?.avatarUrl ? (
              <img className="gh-avatar" src={account.user.avatarUrl} alt="" />
            ) : (
              <div className="gh-avatar gh-avatar-fallback">
                {account.user?.login.slice(0, 1).toUpperCase() ?? 'G'}
              </div>
            )}
            <div className="gh-profile-main">
              <strong>{account.user?.name || account.user?.login}</strong>
              <span className="muted">@{account.user?.login}</span>
              <span className="gh-stats">
                {account.user?.publicRepos ?? 0} public ·{' '}
                {account.user?.totalPrivateRepos ?? 0} private repo
              </span>
            </div>
            <button className="btn-ghost danger" onClick={() => void disconnect()} disabled={busy}>
              Bağlantıyı kes
            </button>
          </div>

          {account.scopes && account.scopes.length > 0 && (
            <div className="gh-scopes">
              <span>Kapsamlar:</span>
              {account.scopes.map((scope) => (
                <code key={scope}>{scope}</code>
              ))}
            </div>
          )}

          <div className="gh-repos-head">
            <h4>Repolar</h4>
            <input
              className="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Repo ara..."
            />
            <button className="btn-ghost" onClick={() => void refresh()} disabled={busy}>
              Yenile
            </button>
          </div>

          <div className="gh-repos">
            {filtered.length === 0 ? (
              <p className="muted">Repo bulunamadı.</p>
            ) : (
              filtered.map((repo) => (
                <div className="gh-repo" key={repo.id}>
                  <div className="gh-repo-main">
                    <div className="gh-repo-name">
                      <span className={`gh-visibility ${repo.private ? 'private' : ''}`}>
                        {repo.private ? 'private' : 'public'}
                      </span>
                      <strong>{repo.fullName}</strong>
                    </div>
                    {repo.description && <span className="gh-repo-desc">{repo.description}</span>}
                    <span className="gh-repo-meta">
                      {repo.defaultBranch}
                      {repo.updatedAt ? ` · ${new Date(repo.updatedAt).toLocaleDateString('tr-TR')}` : ''}
                    </span>
                  </div>
                  <button className="btn-ghost" onClick={() => void openRepo(repo.htmlUrl)}>
                    Aç
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <details className="gh-app-details">
        <summary>GitHub App / installation token</summary>
        <div className="gh-app-details-body">
          <p className="muted gh-device-help">
            Kullanıcı hesabından bağımsız, GitHub App kurulumuna ait kısa ömürlü token.
            Git/PR/CI işlemlerinde kullanılır.
          </p>
          <GithubAppPanel />
        </div>
      </details>
    </div>
  )
}
