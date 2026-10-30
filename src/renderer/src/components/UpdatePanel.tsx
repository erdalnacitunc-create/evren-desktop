import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { api } from '../lib/ipc'
import { useI18n, type TranslationKey } from '../i18n'

const PHASE_KEYS: Record<UpdateStatus['phase'], TranslationKey> = {
  disabled: 'update.phase.disabled',
  idle: 'update.phase.idle',
  checking: 'update.phase.checking',
  available: 'update.phase.available',
  'not-available': 'update.phase.notAvailable',
  downloading: 'update.phase.downloading',
  downloaded: 'update.phase.downloaded',
  error: 'update.phase.error'
}

export function UpdatePanel(): React.JSX.Element {
  const { t } = useI18n()
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

  if (!status) return <p className="muted">{t('update.statusLoading')}</p>

  return (
    <div className="update-panel">
      <div className="update-row">
        <div>
          <strong>EVREN Desktop {status.currentVersion}</strong>
          <span className="muted">{t(PHASE_KEYS[status.phase])}</span>
        </div>
        <button
          className="btn-ghost"
          onClick={() => void check()}
          disabled={busy || !status.canCheck}
        >
          {t('update.checkShort')}
        </button>
      </div>

      {status.phase === 'available' && (
        <div className="update-box">
          <strong>{t('update.available', { version: status.version ?? '' })}</strong>
          {status.releaseNotes && (
            <pre className="update-notes">{status.releaseNotes.slice(0, 3000)}</pre>
          )}
          <button className="btn" onClick={() => void download()} disabled={busy}>
            {t('update.downloadShort')}
          </button>
        </div>
      )}

      {status.phase === 'downloading' && (
        <div className="update-box">
          <div className="update-progress">
            <div style={{ width: `${status.percent ?? 0}%` }} />
          </div>
          <span className="muted">
            {t('update.downloading', { percent: Math.round(status.percent ?? 0) })}
          </span>
        </div>
      )}

      {status.phase === 'downloaded' && (
        <div className="update-box">
          <strong>{t('update.downloaded', { version: status.version ?? '' })}</strong>
          <button className="btn" onClick={() => void install()}>
            {t('update.install')}
          </button>
        </div>
      )}

      {status.phase === 'error' && status.error && (
        <div className="ws-error">{status.error}</div>
      )}
      {error && <div className="ws-error">{error}</div>}

      <p className="muted update-hint">{t('update.note')}</p>
    </div>
  )
}
