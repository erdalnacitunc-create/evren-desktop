import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, HeadlessStatus } from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
}

export function HeadlessPanel({ settings, onSaved }: Props): React.JSX.Element {
  const [status, setStatus] = useState<HeadlessStatus | null>(null)
  const [port, setPort] = useState(settings.headless?.port ?? 45871)
  const [enabled, setEnabled] = useState(settings.headless?.enabled === true)
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [result, settingsResult] = await Promise.all([
      api.headless.status(),
      api.settings.get()
    ])
    if (result.ok) setStatus(result.data)
    else setError(result.error)
    if (settingsResult.ok) {
      setEnabled(settingsResult.data.headless?.enabled === true)
      setPort(settingsResult.data.headless?.port ?? 45871)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (nextEnabled: boolean, nextPort: number): Promise<void> => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const result = await api.headless.configure(nextEnabled, nextPort)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setStatus(result.data)
        setEnabled(nextEnabled)
        setPort(nextPort)
        const next = await api.settings.get()
        if (next.ok) onSaved(next.data)
        if (result.data.error) setError(result.data.error)
        else {
          setNotice(
            nextEnabled
              ? `Headless API çalışıyor: ${result.data.baseUrl}`
              : 'Headless API durduruldu.'
          )
        }
      } finally {
        setBusy(false)
      }
    },
    [onSaved]
  )

  const regenerate = useCallback(async (): Promise<void> => {
    if (!window.confirm('Token yenilensin mi? Mevcut istemciler erişimini kaybeder.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.headless.regenerateToken()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStatus(result.data)
      setNotice('Yeni token oluşturuldu.')
    } finally {
      setBusy(false)
    }
  }, [])

  const copy = useCallback(async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(`${label} kopyalandı.`)
    } catch {
      setError('Panoya kopyalanamadı.')
    }
  }, [])

  const baseUrl = status?.baseUrl ?? `http://127.0.0.1:${port}`

  return (
    <div className="headless-panel">
      <div className="headless-head">
        <div>
          <h4>Headless API</h4>
          <p className="muted headless-hint">
            Yerel OpenAI uyumlu HTTP sunucusu. Yalnızca <code>127.0.0.1</code> üzerinde
            dinler; istekler kayıtlı EVREN API anahtarınızla iletilir. Token olmadan
            erişilemez.
          </p>
        </div>
        <span className={`headless-state ${status?.running ? 'on' : ''}`}>
          {status?.running ? 'Çalışıyor' : 'Kapalı'}
        </span>
      </div>

      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      <div className="headless-controls">
        <label className="mcp-checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>Sunucuyu etkinleştir</span>
        </label>
        <label className="field headless-port">
          <span>Port</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(event) => setPort(Number(event.target.value))}
          />
        </label>
        <button
          className="btn"
          onClick={() => void save(enabled, port)}
          disabled={busy || port < 1024 || port > 65535}
        >
          {busy ? 'Uygulanıyor...' : enabled ? 'Başlat / uygula' : 'Durdur / uygula'}
        </button>
      </div>

      <section className="headless-section">
        <h5>Bağlantı</h5>
        <div className="headless-row">
          <code>{baseUrl}</code>
          <button className="btn-ghost" onClick={() => void copy(baseUrl, 'Adres')}>
            Kopyala
          </button>
        </div>
        <div className="headless-row">
          <code className="headless-token">
            {status?.token
              ? showToken
                ? status.token
                : '•'.repeat(32)
              : 'Token oluşturulmadı'}
          </code>
          <button
            className="btn-ghost"
            onClick={() => setShowToken((value) => !value)}
            disabled={!status?.token}
          >
            {showToken ? 'Gizle' : 'Göster'}
          </button>
          <button
            className="btn-ghost"
            onClick={() => status?.token && void copy(status.token, 'Token')}
            disabled={!status?.token}
          >
            Kopyala
          </button>
          <button className="btn-ghost danger" onClick={() => void regenerate()} disabled={busy}>
            Yenile
          </button>
        </div>
        {status && (
          <p className="muted headless-stats">
            {status.requestCount} istek
            {status.lastRequestAt
              ? ` · son: ${new Date(status.lastRequestAt).toLocaleString('tr-TR')}`
              : ''}
          </p>
        )}
      </section>

      <section className="headless-section">
        <h5>Uç noktalar</h5>
        <div className="headless-endpoints">
          <code>GET /health</code>
          <span>Kimlik doğrulamasız sağlık kontrolü</span>
          <code>GET /v1/models</code>
          <span>Model listesi (proxy)</span>
          <code>POST /v1/chat/completions</code>
          <span>OpenAI uyumlu sohbet; <code>stream:true</code> SSE</span>
          <code>GET/POST /v1/sessions</code>
          <span>Oturum listesi / oluşturma</span>
          <code>GET/DELETE /v1/sessions/:id</code>
          <span>Oturum getirme / silme</span>
        </div>
        <p className="muted headless-hint">
          Tüm <code>/v1/*</code> istekleri <code>Authorization: Bearer &lt;token&gt;</code>{' '}
          gerektirir. Diğer <code>/v1/*</code> yolları EVREN API'sine şeffaf proxy edilir.
        </p>
      </section>

      <section className="headless-section">
        <h5>SDK</h5>
        <pre className="headless-code">{`import { EvrenClient } from './sdk/evren-client.mjs'

const client = new EvrenClient({
  baseUrl: '${baseUrl}',
  token: process.env.EVREN_HEADLESS_TOKEN
})

const stream = client.stream([
  { role: 'user', content: 'Merhaba' }
], { model: 'gemma-4-31b' })

for await (const text of stream) process.stdout.write(text)`}</pre>
        <p className="muted headless-hint">
          SDK dosyası: <code>sdk/evren-client.mjs</code>. ACP için{' '}
          <code>--acp</code> bayrağıyla başlatın; ayrıntılar <code>docs/HEADLESS.md</code>.
        </p>
      </section>
    </div>
  )
}
