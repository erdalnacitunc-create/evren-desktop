import { useState } from 'react'
import type { AppSettings, ReferenceDirectory } from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  settings: AppSettings
  onSaved: (settings: AppSettings) => void
}

interface DraftReference {
  name: string
  path: string
}

const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/

function asDrafts(settings: AppSettings): DraftReference[] {
  return (settings.references ?? []).map((item) => ({
    name: item.name,
    path: item.path
  }))
}

export function ReferencesPanel({ settings, onSaved }: Props): React.JSX.Element {
  const [items, setItems] = useState<DraftReference[]>(asDrafts(settings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function update(index: number, patch: Partial<DraftReference>): void {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    )
    setError(null)
    setOk(null)
  }

  async function choosePath(index: number): Promise<void> {
    const result = await api.app.chooseDirectory('Referans klasörü seç')
    if (!result.ok || !result.data) return
    update(index, { path: result.data })
  }

  async function save(): Promise<void> {
    setError(null)
    setOk(null)
    const cleaned = items
      .map((item) => ({ name: item.name.trim(), path: item.path.trim() }))
      .filter((item) => item.name || item.path)

    const names = new Set<string>()
    for (const item of cleaned) {
      if (!NAME_RE.test(item.name)) {
        setError(`Geçersiz isim: "${item.name}". Harf, rakam, _, . ve - kullanın.`)
        return
      }
      if (!item.path) {
        setError(`"${item.name}" için klasör yolu gerekli.`)
        return
      }
      const key = item.name.toLowerCase()
      if (names.has(key)) {
        setError(`Aynı isim birden fazla kez kullanılamaz: "${item.name}".`)
        return
      }
      names.add(key)
    }

    setBusy(true)
    try {
      const result = await api.settings.update({
        references: cleaned as ReferenceDirectory[]
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setItems(asDrafts(result.data))
      onSaved(result.data)
      setOk('Referanslar kaydedildi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-section">
      <h3>Referanslar</h3>
      <p className="muted">
        Workspace dışındaki klasörleri agent’a <strong>read-only</strong> açar.
        Agent yalnızca burada tanımlı klasörlerin içindeki dosyaları okuyabilir.
      </p>

      <div className="reference-list">
        {items.map((item, index) => (
          <div className="reference-row" key={index}>
            <label className="field reference-name">
              <span>İsim</span>
              <input
                value={item.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="docs"
                disabled={busy}
              />
            </label>
            <label className="field reference-path">
              <span>Klasör</span>
              <input
                value={item.path}
                onChange={(event) => update(index, { path: event.target.value })}
                placeholder="C:\Users\...\Documents"
                disabled={busy}
              />
            </label>
            <button
              className="btn-ghost"
              onClick={() => void choosePath(index)}
              disabled={busy}
              type="button"
            >
              Gözat
            </button>
            <button
              className="btn-ghost danger"
              onClick={() => {
                setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                setError(null)
                setOk(null)
              }}
              disabled={busy}
              type="button"
              title="Referansı kaldır"
            >
              Sil
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="muted">Henüz referans klasörü tanımlanmadı.</p>
        )}
      </div>

      <div className="inline-actions">
        <button
          className="btn-ghost"
          onClick={() => setItems((current) => [...current, { name: '', path: '' }])}
          disabled={busy}
          type="button"
        >
          + Referans ekle
        </button>
        <button className="btn" onClick={() => void save()} disabled={busy} type="button">
          {busy ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {ok && <p className="ok">{ok}</p>}
    </div>
  )
}
