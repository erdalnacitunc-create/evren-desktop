import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, KeyStatus, McpElicitationRequest, ModelInfo, QuotaStatus } from '@shared/types'
import { api } from './lib/ipc'
import { applyTheme } from './lib/theme'
import { DEFAULT_LOCALE, isLocale, setLocale } from './i18n'
import { McpElicitationModal } from './components/McpElicitationModal'
import { Onboarding } from './components/Onboarding'
import { Workspace } from './components/Workspace'

type Phase = 'loading' | 'onboarding' | 'ready'

const FALLBACK_SETTINGS: AppSettings = { baseUrl: 'https://evren-llmapi.ssyz.org.tr' }

export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS)
  const [notice, setNotice] = useState<string | null>(null)
  const [elicitations, setElicitations] = useState<McpElicitationRequest[]>([])

  const loadWorkspace = useCallback(async (): Promise<void> => {
    setPhase('loading')
    setNotice(null)

    const [status, config] = await Promise.all([api.key.status(), api.settings.get()])
    if (config.ok) setSettings(config.data)

    if (!status.ok) {
      setNotice(status.error)
      setPhase('onboarding')
      return
    }
    setKeyStatus(status.data)

    if (!status.data.hasKey) {
      setPhase('onboarding')
      return
    }

    const [modelsResult, quotaResult] = await Promise.all([api.models.list(), api.quota.get()])

    if (!modelsResult.ok) {
      setNotice(modelsResult.error)
      setPhase('onboarding')
      return
    }

    setModels(modelsResult.data)
    setQuota(quotaResult.ok ? quotaResult.data : null)
    setPhase('ready')
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    return api.mcp.onElicitation((request) => {
      setElicitations((current) => [...current, request])
    })
  }, [])

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  // Dil ayarlardan gelir; yoksa Türkçe.
  useEffect(() => {
    setLocale(isLocale(settings.locale) ? settings.locale : DEFAULT_LOCALE)
  }, [settings.locale])

  useEffect(() => {
    if (settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (): void => {
      applyTheme('system')
    }
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [settings.theme])

  const handleSignOut = useCallback(async (): Promise<void> => {
    setModels([])
    setQuota(null)
    setKeyStatus(null)
    await api.key.clear()
    await loadWorkspace()
  }, [loadWorkspace])

  if (phase === 'loading') {
    return (
      <div className="loading">
        <span className="spinner" />
        <span>Yükleniyor...</span>
      </div>
    )
  }

  if (phase === 'onboarding') {
    return (
      <Onboarding
        encryptionAvailable={keyStatus?.encryptionAvailable ?? true}
        notice={notice}
        onComplete={() => void loadWorkspace()}
      />
    )
  }

  return (
    <>
      <Workspace
        models={models}
        quota={quota}
        keyStatus={keyStatus}
        settings={settings}
        onSignOut={() => void handleSignOut()}
        onRefresh={() => void loadWorkspace()}
        onSettingsChange={setSettings}
      />
      {elicitations[0] && (
        <McpElicitationModal
          request={elicitations[0]}
          onDone={() => setElicitations((current) => current.slice(1))}
        />
      )}
    </>
  )
}
