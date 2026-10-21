import { useCallback, useEffect, useState } from 'react'
import type { GithubAppInstallation, GithubAppStatus } from '@shared/types'
import { api } from '../lib/ipc'

function formatExpiry(value: number | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function GithubAppPanel(): React.JSX.Element {
  const [status, setStatus] = useState<GithubAppStatus | null>(null)
  const [appId, setAppId] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [installations, setInstallations] = useState<GithubAppInstallation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await api.githubApp.status()
    if (result.ok) {
      setStatus(result.data)
      if (result.data.appId) setAppId(result.data.appId)
    } else setError(result.error)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveAndList = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await api.githubApp.saveCredentials(appId, privateKey)
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      setStatus(saved.data)
      setPrivateKey('')
      const list = await api.githubApp.installations()
      if (!list.ok) {
        setError(list.error)
        return
      }
      setInstallations(list.data)
      setNotice(
        list.data.length > 0
          ? `${list.data.length} kurulum bulundu. Birini seçin.`
          : 'Kurulum bulunamadı. GitHub App’i hesabınıza kurun.'
      )
    } finally {
      setBusy(false)
    }
  }, [appId, privateKey])

  const loadInstallations = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const list = await api.githubApp.installations()
      if (!list.ok) {
        setError(list.error)
        return
      }
      setInstallations(list.data)
      setNotice(list.data.length ? `${list.data.length} kurulum bulundu.` : 'Kurulum yok.')
    } finally {
      setBusy(false)
    }
  }, [])

  const connect = useCallback(async (installation: GithubAppInstallation): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.githubApp.connect(installation.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStatus(result.data)
      setInstallations([])
      setNotice(`Kurulum bağlandı: ${installation.accountLogin}`)
    } finally {
      setBusy(false)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.githubApp.refresh()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStatus(result.data)
      setNotice('Token yenilendi.')
    } finally {
      setBusy(false)
    }
  }, [])

  const disconnect = useCallback(async (): Promise<void> => {
    if (!window.confirm('GitHub App bağlantısı ve private key silinsin mi?')) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.githubApp.disconnect()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStatus(result.data)
      setPrivateKey('')
      setInstallations([])
      setNotice('GitHub App bağlantısı kaldırıldı.')
    } finally {
      setBusy(false)
    }
  }, [])

  const readKeyFile = useCallback(async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      setPrivateKey(await file.text())
      setNotice(`${file.name} yüklendi.`)
    } catch {
      setError('Private key dosyası okunamadı.')
    }
  }, [])

  const openApps = useCallback(async (): Promise<void> => {
    const result = await api.app.openExternal('https://github.com/settings/apps')
    if (!result.ok) setError(result.error)
  }, [])

  if (!status) return <p className="muted">GitHub App durumu yükleniyor...</p>

  return (
    <div className="gh-app-panel">
      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      {status.configured ? (
        <>
          <div className="gh-app-status">
            <span className="gh-app-ok">Bağlı</span>
            <div>
              <strong>{status.accountLogin ?? 'Kurulum'}</strong>
              <span className="muted">
                App ID {status.appId} · installation {status.installationId}
              </span>
              <span className="muted">
                Repo erişimi: {status.repositorySelection ?? '—'} · token:{' '}
                {formatExpiry(status.tokenExpiresAt)}
              </span>
            </div>
            <div className="gh-device-actions">
              <button className="btn-ghost" onClick={() => void refresh()} disabled={busy}>
                Token yenile
              </button>
              <button className="btn-ghost danger" onClick={() => void disconnect()} disabled={busy}>
                Kaldır
              </button>
            </div>
          </div>
          <p className="muted gh-device-help">
            Installation token yaklaşık 1 saat geçerlidir; süresi dolunca otomatik yenilenir.
            Bu token Git/PR/CI işlemlerinde kullanılır.
          </p>
        </>
      ) : (
        <>
          {status.appId && (
            <p className="muted">
              Kayıtlı App ID: <code>{status.appId}</code>.{' '}
              {status.hasKey
                ? 'Kurulumları getirerek devam edin veya farklı bir private key yükleyin.'
                : "Private key'i yeniden yükleyin."}
            </p>
          )}
          <label className="field">
            <span>GitHub App ID</span>
            <input
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              placeholder="123456"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Private key (PEM)</span>
            <textarea
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
              rows={4}
              spellCheck={false}
            />
          </label>
          <div className="gh-device-actions">
            <input
              type="file"
              accept=".pem,.key,text/plain"
              onChange={(event) => void readKeyFile(event.target.files?.[0])}
            />
            <button
              className="btn"
              onClick={() => void saveAndList()}
              disabled={busy || !appId.trim() || !privateKey.trim()}
            >
              Kaydet ve kurulumları getir
            </button>
            {status.appId && (
              <button className="btn-ghost" onClick={() => void loadInstallations()} disabled={busy}>
                Kurulumları getir
              </button>
            )}
          </div>
          <p className="muted gh-device-help">
            GitHub App’i oluştururken <strong>Contents</strong>, <strong>Pull requests</strong> ve{' '}
            <strong>Actions</strong> izinlerini verin; ardından App’i hesabınıza/org’a kurun.
            Private key yalnızca DPAPI ile saklanır.
          </p>
          <button className="btn-ghost gh-token-link" onClick={() => void openApps()}>
            GitHub Apps oluştur / yönet
          </button>

          {installations.length > 0 && (
            <div className="gh-app-installations">
              {installations.map((installation) => (
                <div className="gh-app-installation" key={installation.id}>
                  <div>
                    <strong>{installation.accountLogin}</strong>
                    <span className="muted">
                      {installation.accountType} · {installation.repositorySelection}
                    </span>
                  </div>
                  <button
                    className="btn-ghost"
                    onClick={() => void connect(installation)}
                    disabled={busy}
                  >
                    Bağla
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
