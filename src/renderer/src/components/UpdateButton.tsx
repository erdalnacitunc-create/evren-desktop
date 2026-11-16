import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { api } from '../lib/ipc'
import { useI18n } from '../i18n'
import { downloadPercent, updateButtonState } from '../lib/updateButton'

/**
 * Üst çubuktaki güncelleme düğmesi.
 *
 * ## Neden ayrı düğme
 *
 * Güncelleme akışı Ayarlar > Genel içindeydi; kullanıcı üç tık uzağa bakmak
 * zorundaydı. opencode ve Antigravity yeni sürümü **her zaman görünür** bir
 * rozetle bildirir; tıklayınca indirir, indiğinde "yeniden başlat"a döner.
 * Aynı davranış burada da uygulanır.
 *
 * Davranış tablosu `lib/updateButton.ts` içinde saf fonksiyon olarak durur ve
 * test edilir (`update-button-test`).
 */

export function UpdateButton(): React.JSX.Element | null {
  const { t } = useI18n()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const result = await api.updater.status()
    if (result.ok) setStatus(result.data)
  }, [])

  useEffect(() => {
    void load()
    return api.updater.onStatus((next) => setStatus(next))
  }, [load])

  const run = useCallback(
    async (action: () => Promise<{ ok: boolean; data?: unknown }>) => {
      setBusy(true)
      try {
        const result = await action()
        if (result.ok && result.data && typeof result.data === 'object') {
          setStatus(result.data as UpdateStatus)
        }
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const state = updateButtonState(status, busy)
  if (!state.visible || !status) return null

  const percent = downloadPercent(status.percent)
  const label =
    state.tone === 'ready'
      ? t('update.topbarReady')
      : state.tone === 'available'
        ? t('update.topbarAvailable', { version: status.version ?? '' })
        : status.phase === 'downloading'
          ? t('update.topbarDownloading', { percent })
          : status.phase === 'checking'
            ? t('update.checking')
            : state.tone === 'error'
              ? t('update.topbarError')
              : t('update.topbarCheck')

  const title = status.phase === 'error' && status.error ? `${label} — ${status.error}` : label

  const onClick = (): void => {
    if (state.disabled) return
    if (state.intent === 'install') {
      void run(() => api.updater.install())
      return
    }
    if (state.intent === 'download') {
      void run(() => api.updater.download())
      return
    }
    void run(() => api.updater.check())
  }

  const className = [
    'update-btn',
    state.tone === 'available' ? 'is-available' : '',
    state.tone === 'ready' ? 'is-ready' : '',
    state.tone === 'error' ? 'is-error' : '',
    state.tone === 'busy' ? 'is-busy' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={state.disabled}
      title={title}
      aria-label={title}
    >
      <span className="update-btn-icon" aria-hidden="true">
        {state.tone === 'ready' ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M2.5 8a5.5 5.5 0 1 0 1.9-4.16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M2 2.2v3.4h3.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : state.tone === 'available' ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 2.5v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path
              d="M4.6 7.2 8 10.6l3.4-3.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.9-4.16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M14 2.2v3.4h-3.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="update-btn-text">{label}</span>
      {state.showDot && <span className="update-btn-dot" aria-hidden="true" />}
    </button>
  )
}
