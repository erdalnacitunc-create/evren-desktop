import { useState } from 'react'
import { api } from '../lib/ipc'
import { EvrenLogo } from './EvrenLogo'

interface Props {
  encryptionAvailable: boolean
  notice?: string | null
  onComplete: () => void
}

export function Onboarding({ encryptionAvailable, notice, onComplete }: Props): React.JSX.Element {
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
      <div className="onboarding-card">
        <div className="brand brand-lg">
          <EvrenLogo size={48} className="evren-logo" />
          <div>
            <h1>EVREN Desktop</h1>
            <p>Savunma Sanayii Yapay Zeka Platformu</p>
          </div>
        </div>

        <h2>EVREN'e bağlan</h2>
        <p className="muted">
          Resmi panelden aldığınız API anahtarını girin. Anahtar cihazınızda Windows
          DPAPI ile şifrelenerek saklanır ve yalnızca ana süreçte tutulur.
        </p>

        {notice && <p className="error">{notice}</p>}

        <a
          className="link"
          href="https://evren.ssyz.org.tr/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          API anahtarı almak için paneli aç ↗
        </a>

        <form onSubmit={handleSubmit} className="key-form">
          <label className="field">
            <span>API anahtarı</span>
            <div className="input-row">
              <input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="evren_..."
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
                {show ? 'Gizle' : 'Göster'}
              </button>
            </div>
          </label>

          {!encryptionAvailable && (
            <p className="warn">
              Bu sistemde güvenli saklama (DPAPI) kullanılamıyor; anahtar kalıcı olarak
              kaydedilemez.
            </p>
          )}

          {error && <p className="error">{error}</p>}
          {found !== null && !error && (
            <p className="ok">Doğrulandı — {found} model bulundu.</p>
          )}

          <button className="btn btn-block" type="submit" disabled={busy || !key.trim()}>
            {busy ? 'Doğrulanıyor...' : 'Doğrula ve kaydet'}
          </button>
        </form>

        <p className="fineprint">
          Anahtarınız bu uygulama dışında hiçbir yere gönderilmez; yalnızca
          evren-llmapi.ssyz.org.tr ile konuşur.
        </p>
      </div>
    </div>
  )
}
