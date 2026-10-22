import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { api } from '../lib/ipc'

const PHASE_LABELS: Record<UpdateStatus['phase'], string> = {
  disabled: 'Devre dışı',
  idle: 'Hazır',
  checking: 'Kontrol ediliyor...',
  available: 'Yeni sürüm var',
  'not-available': 'Güncel',
  downloading: 'İndiriliyor...',
  downloaded: 'İndirildi',
  error: 'Hata'
}

export function UpdatePanel(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await api.updater.status()
    if (result.ok) setStatus(result.data)
    else setError(result.error)
  }, [])

  useEffect(() => {
    void load()
    return api.updater.onStatus((next) => setStatus(next))
  }, [load])

  const check = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.updater.check()
      if (!result.ok) setError(result.error)
      else setStatus(result.data)
    } finally {
      setBusy(false)
    }
  }, [])

  const download = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.updater.download()
      if (!result.ok) setError(result.error)
      else setStatus(result.data)
    } finally {
      setBusy(false)
    }
  }, [])

  const install = useCallback(async (): Promise<void> => {
    const result = await api.updater.install()
    if (!result.ok) setError(result.error)
  }, [])

  if (!status) return <p className="muted">Güncelleme durumu yükleniyor...</p>

  return (
    <div className="update-panel">
      <div className="update-row">
        <div>
          <strong>EVREN Desktop {status.currentVersion}</strong>
          <span className="muted">{PHASE_LABELS[status.phase]}</span>
        </div>
        <button
          className="btn-ghost"
          onClick={() => void check()}
          disabled={busy || !status.canCheck}
        >
          Güncelleme kontrol et
        </button>
      </div>

      {status.phase === 'available' && (
        <div className="update-box">
          <strong>Yeni sürüm: {status.version}</strong>
          {status.releaseNotes && (
            <pre className="update-notes">{status.releaseNotes.slice(0, 3000)}</pre>
          )}
          <button className="btn" onClick={() => void download()} disabled={busy}>
            Güncellemeyi indir
          </button>
        </div>
      )}

      {status.phase === 'downloading' && (
        <div className="update-box">
          <div className="update-progress">
            <div style={{ width: `${status.percent ?? 0}%` }} />
          </div>
          <span className="muted">%{Math.round(status.percent ?? 0)}</span>
        </div>
      )}

      {status.phase === 'downloaded' && (
        <div className="update-box">
          <strong>{status.version} indirildi.</strong>
          <button className="btn" onClick={() => void install()}>
            Yeniden başlat ve kur
          </button>
        </div>
      )}

      {status.phase === 'error' && status.error && (
        <div className="ws-error">{status.error}</div>
      )}
      {error && <div className="ws-error">{error}</div>}

      <p className="muted update-hint">
        Güncellemeler GitHub Releases üzerinden alınır. İmzalı sürümlerde Windows
        yayıncı doğrulaması kullanılır; beta kanalı etkin.
      </p>
    </div>
  )
}
