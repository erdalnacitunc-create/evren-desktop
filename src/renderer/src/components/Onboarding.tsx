import { useState } from 'react'
import { api } from '../lib/ipc'
import { useI18n } from '../i18n'
import { EvrenLogo } from './EvrenLogo'
import { WindowControls } from './WindowControls'

interface Props {
  encryptionAvailable: boolean
  notice?: string | null
  onComplete: () => void
}

export function Onboarding({ encryptionAvailable, notice, onComplete }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<number | null>(null)

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setFound(null)
    setBusy(true)
    try {
      const validation = await api.key.validate(key)
      if (!validation.ok) {
        setError(validation.error)
        return
      }
      setFound(validation.data.length)

      const saved = await api.key.save(key)
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      onComplete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboarding">
      <div
        className="onboarding-drag-region"
        onDoubleClick={() => void api.appWindow.toggleMaximize()}
        aria-hidden="true"
      />
      <WindowControls className="onboarding-window-controls" />
      <div className="onboarding-card">
        <div className="brand brand-lg">
          <EvrenLogo size={48} className="evren-logo" />
          <div>
            <h1>{t('onboarding.title')}</h1>
            <p>{t('brand.tagline')}</p>
          </div>
        </div>

        <h2>{t('onboarding.connect')}</h2>
        <p className="muted">{t('onboarding.description')}</p>

        {notice && <p className="error">{notice}</p>}

        <a
          className="link"
          href="https://evren.ssyz.org.tr/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          {t('onboarding.openPanel')}
        </a>

        <form onSubmit={handleSubmit} className="key-form">
          <label className="field">
            <span>{t('onboarding.keyLabel')}</span>
            <div className="input-row">
              <input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('onboarding.keyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                required
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
              >
                {show ? t('onboarding.hide') : t('onboarding.show')}
              </button>
            </div>
          </label>

          {!encryptionAvailable && (
            <p className="warn">{t('onboarding.encryptionUnavailable')}</p>
          )}

          {error && <p className="error">{error}</p>}
          {found !== null && !error && (
            <p className="ok">{t('onboarding.validated', { count: found })}</p>
          )}

          <button className="btn btn-block" type="submit" disabled={busy || !key.trim()}>
            {busy ? t('onboarding.validating') : t('onboarding.validateAndSave')}
          </button>
        </form>

        <p className="fineprint">{t('onboarding.fineprint')}</p>
      </div>
    </div>
  )
}
