import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import { useI18n } from '../i18n'

interface Props {
  className?: string
}

export function WindowControls({ className = '' }: Props): React.JSX.Element | null {
  const { t } = useI18n()
  const [maximized, setMaximized] = useState(false)
  const isMac = api.platform === 'darwin'

  useEffect(() => {
    if (isMac) return
    void api.appWindow.isMaximized().then((result) => {
      if (result.ok) setMaximized(result.data)
    })
    return api.appWindow.onMaximized((value) => setMaximized(value))
  }, [isMac])

  if (isMac) return null

  const maximizeLabel = maximized ? t('window.restore') : t('window.maximize')

  return (
    <div className={`window-controls ${className}`}>
      <button
        className="window-control"
        onClick={() => void api.appWindow.minimize()}
        title={t('window.minimize')}
        aria-label={t('window.minimize')}
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
        title={maximizeLabel}
        aria-label={maximizeLabel}
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
            <path d="M3.8 3.2V2h4.2v4.2H6.8" fill="none" stroke="currentColor" strokeWidth="1.1" />
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
        title={t('window.close')}
        aria-label={t('window.close')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M2 2l6 6M8 2L2 8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
