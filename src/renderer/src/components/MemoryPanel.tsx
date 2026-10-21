import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  CompactionSettings,
  MemoryEntry,
  MemorySettings,
  MemoryType,
  ModelInfo
} from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  settings: AppSettings
  models: ModelInfo[]
  onSaved: (settings: AppSettings) => void
}

const DEFAULT_MEMORY: MemorySettings = {
  autoMemory: true,
  extractionModel: 'session',
  retrievalTopK: 6,
  retrievalTokenBudget: 900,
  maxMemories: 2000
}

const DEFAULT_COMPACTION: CompactionSettings = {
  auto: true,
  thresholdPercent: 80,
  keepTokens: 15000,
  bufferPercent: 10
}

const TYPE_LABELS: Record<MemoryType, string> = {
  user: 'Kullanıcı',
  feedback: 'Geri bildirim',
  project: 'Proje',
  reference: 'Referans'
}

export function MemoryPanel({ settings, models, onSaved }: Props): React.JSX.Element {
  const [memorySettings, setMemorySettings] = useState<MemorySettings>(
    settings.memory ?? DEFAULT_MEMORY
  )
  const [compaction, setCompaction] = useState<CompactionSettings>(
    settings.compaction ?? DEFAULT_COMPACTION
  )
  const [instructions, setInstructions] = useState('')
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | MemoryType>('all')
  const [newType, setNewType] = useState<MemoryType>('user')
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    setMemorySettings(settings.memory ?? DEFAULT_MEMORY)
    setCompaction(settings.compaction ?? DEFAULT_COMPACTION)
  }, [settings.memory, settings.compaction])

  const load = useCallback(async (): Promise<void> => {
    const [list, text] = await Promise.all([api.memory.list(), api.memory.getInstructions()])
    if (list.ok) setMemories(list.data)
    if (text.ok) setInstructions(text.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const chatModels = useMemo(
    () => models.filter((model) => model.task === 'chat' || model.task === 'vision_chat'),
    [models]
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return memories.filter((entry) => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false
      if (!needle) return true
      return (
        entry.text.toLowerCase().includes(needle) ||
        (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      )
    })
  }, [memories, query, typeFilter])

  async function saveMemorySettings(patch: Partial<MemorySettings>): Promise<void> {
    const next = { ...memorySettings, ...patch }
    setMemorySettings(next)
    const result = await api.memory.updateSettings(patch)
    if (result.ok) {
      onSaved({ ...settings, memory: result.data })
    } else {
      setError(result.error)
    }
  }

  async function saveCompaction(patch: Partial<CompactionSettings>): Promise<void> {
    const next = { ...compaction, ...patch }
    setCompaction(next)
    const result = await api.settings.update({ compaction: next })
    if (result.ok) onSaved(result.data)
    else setError(result.error)
  }

  async function saveInstructions(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.memory.setInstructions(instructions)
      setNotice(result.ok ? 'Talimatlar kaydedildi.' : null)
      if (!result.ok) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  async function addMemory(): Promise<void> {
    const text = newText.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.memory.add({ type: newType, text })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNewText('')
      setNotice('Anı eklendi.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function togglePin(entry: MemoryEntry): Promise<void> {
    await api.memory.update(entry.id, { pinned: !entry.pinned })
    await load()
  }

  async function removeMemory(entry: MemoryEntry): Promise<void> {
    await api.memory.delete(entry.id)
    await load()
  }

  async function saveEdit(): Promise<void> {
    if (!editingId) return
    const text = editingText.trim()
    if (!text) return
    const result = await api.memory.update(editingId, { text })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditingId(null)
    setEditingText('')
    await load()
  }

  async function clearAll(): Promise<void> {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setBusy(true)
    try {
      await api.memory.clear()
      setConfirmClear(false)
      setNotice('Tüm anılar silindi.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memory-panel">
      {notice && <p className="ok">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <section className="memory-section">
        <h4>Otomatik hafıza</h4>
        <label className="params-check">
          <input
            type="checkbox"
            checked={memorySettings.autoMemory}
            onChange={(e) => void saveMemorySettings({ autoMemory: e.target.checked })}
          />
          <span>Konuşmalardan otomatik anı çıkar</span>
        </label>
        <div className="memory-grid">
          <label className="field">
            <span>Çıkarım modeli</span>
            <select
              value={memorySettings.extractionModel}
              onChange={(e) => void saveMemorySettings({ extractionModel: e.target.value })}
            >
              <option value="session">Oturum modeli</option>
              {chatModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Getirim sayısı (top-k)</span>
            <input
              type="number"
              min={1}
              max={20}
              value={memorySettings.retrievalTopK}
              onChange={(e) => void saveMemorySettings({ retrievalTopK: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Getirim token bütçesi</span>
            <input
              type="number"
              min={100}
              max={4000}
              step={100}
              value={memorySettings.retrievalTokenBudget}
              onChange={(e) =>
                void saveMemorySettings({ retrievalTokenBudget: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Maksimum anı</span>
            <input
              type="number"
              min={100}
              max={10000}
              step={100}
              value={memorySettings.maxMemories}
              onChange={(e) => void saveMemorySettings({ maxMemories: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="params-note">
          Getirim embedding + anahtar kelime hibrit çalışır. Anılar DPAPI ile şifreli saklanır.
        </p>
      </section>

      <section className="memory-section">
        <h4>Kalıcı talimatlar</h4>
        <textarea
          className="memory-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={5}
          placeholder="Her oturumda modele iletilecek kalıcı talimatlar (tercihler, kurallar, bağlam)..."
        />
        <div className="inline-actions">
          <button className="btn" onClick={() => void saveInstructions()} disabled={busy}>
            Kaydet
          </button>
        </div>
      </section>

      <section className="memory-section">
        <h4>Sıkıştırma</h4>
        <label className="params-check">
          <input
            type="checkbox"
            checked={compaction.auto}
            onChange={(e) => void saveCompaction({ auto: e.target.checked })}
          />
          <span>Otomatik sıkıştır</span>
        </label>
        <div className="memory-grid">
          <label className="field">
            <span>Eşik (%)</span>
            <input
              type="number"
              min={50}
              max={95}
              value={compaction.thresholdPercent}
              onChange={(e) => void saveCompaction({ thresholdPercent: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Korunan son token</span>
            <input
              type="number"
              min={1000}
              max={200000}
              step={1000}
              value={compaction.keepTokens}
              onChange={(e) => void saveCompaction({ keepTokens: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Buffer (%)</span>
            <input
              type="number"
              min={0}
              max={40}
              value={compaction.bufferPercent}
              onChange={(e) => void saveCompaction({ bufferPercent: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="memory-section">
        <div className="memory-head">
          <h4>Anılar ({memories.length})</h4>
          <button className="btn-ghost danger" onClick={() => void clearAll()} disabled={busy}>
            {confirmClear ? 'Emin misiniz? Tümünü sil' : 'Tümünü temizle'}
          </button>
        </div>

        <div className="memory-filters">
          <input
            className="search"
            placeholder="Anılarda ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="memory-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | MemoryType)}
          >
            <option value="all">Tüm türler</option>
            {(Object.keys(TYPE_LABELS) as MemoryType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="memory-add">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as MemoryType)}
          >
            {(Object.keys(TYPE_LABELS) as MemoryType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Yeni anı metni..."
          />
          <button className="btn" onClick={() => void addMemory()} disabled={busy || !newText.trim()}>
            Ekle
          </button>
        </div>

        <div className="memory-list">
          {visible.map((entry) => (
            <div key={entry.id} className={`memory-item ${entry.pinned ? 'pinned' : ''}`}>
              <div className="memory-item-head">
                <span className={`unit-badge unit-${entry.type === 'project' ? 'mcp' : 'skill'}`}>
                  {TYPE_LABELS[entry.type]}
                </span>
                {entry.pinned && <span className="memory-pin">sabit</span>}
                <span className="memory-date">
                  {new Date(entry.updatedAt).toLocaleDateString('tr-TR')}
                </span>
              </div>
              {editingId === entry.id ? (
                <div className="memory-edit">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={3}
                  />
                  <div className="inline-actions">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setEditingId(null)
                        setEditingText('')
                      }}
                    >
                      Vazgeç
                    </button>
                    <button className="btn" onClick={() => void saveEdit()}>
                      Kaydet
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="memory-text">{entry.text}</p>
                  <div className="memory-actions">
                    <button className="btn-ghost" onClick={() => void togglePin(entry)}>
                      {entry.pinned ? 'Sabitten çıkar' : 'Sabitle'}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setEditingId(entry.id)
                        setEditingText(entry.text)
                      }}
                    >
                      Düzenle
                    </button>
                    <button className="btn-ghost danger" onClick={() => void removeMemory(entry)}>
                      Sil
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {visible.length === 0 && <p className="muted">Anı bulunamadı.</p>}
        </div>
      </section>
    </div>
  )
}
