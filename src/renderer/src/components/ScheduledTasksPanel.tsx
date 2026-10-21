import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModelInfo, ScheduledTask, ScheduleKind } from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  models: ModelInfo[]
}

const KIND_LABELS: Record<ScheduleKind, string> = {
  once: 'Tek seferlik',
  interval: 'Aralıklı',
  daily: 'Günlük'
}

function defaultOnceValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(value: number | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function scheduleText(task: ScheduledTask): string {
  if (task.kind === 'once') return task.runAt ? formatDate(task.runAt) : 'Tarih yok'
  if (task.kind === 'interval') return `${task.intervalMinutes ?? 60} dakikada bir`
  return `Her gün ${task.time ?? '09:00'}`
}

export function ScheduledTasksPanel({ models }: Props): React.JSX.Element {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const chatModels = useMemo(
    () => models.filter((model) => model.task === 'chat' || model.task === 'vision_chat'),
    [models]
  )

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('once')
  const [onceAt, setOnceAt] = useState(defaultOnceValue)
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [time, setTime] = useState('09:00')

  useEffect(() => {
    if (!modelId && chatModels.length > 0) setModelId(chatModels[0].id)
  }, [chatModels, modelId])

  const refresh = useCallback(async (): Promise<void> => {
    const result = await api.scheduled.list()
    if (result.ok) setTasks(result.data)
    else setError(result.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async (): Promise<void> => {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.scheduled.create({
        name,
        prompt,
        modelId,
        kind,
        runAt: kind === 'once' ? new Date(onceAt).getTime() : undefined,
        intervalMinutes: kind === 'interval' ? intervalMinutes : undefined,
        time: kind === 'daily' ? time : undefined,
        enabled: true
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setName('')
      setPrompt('')
      setShowForm(false)
      setNotice('Görev oluşturuldu.')
      await refresh()
    } finally {
      setCreating(false)
    }
  }, [name, prompt, modelId, kind, onceAt, intervalMinutes, time, refresh])

  const toggle = useCallback(
    async (task: ScheduledTask): Promise<void> => {
      setBusyId(task.id)
      setError(null)
      try {
        const result = await api.scheduled.update(task.id, { enabled: !task.enabled })
        if (!result.ok) {
          setError(result.error)
          return
        }
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [refresh]
  )

  const runNow = useCallback(
    async (task: ScheduledTask): Promise<void> => {
      setBusyId(task.id)
      setError(null)
      setNotice(null)
      try {
        const result = await api.scheduled.runNow(task.id)
        if (!result.ok) {
          setError(result.error)
          return
        }
        if (result.data?.lastError) {
          setError(result.data.lastError)
        } else {
          setNotice(`"${task.name}" çalıştırıldı. Sonuç yeni bir oturumda.`)
        }
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [refresh]
  )

  const remove = useCallback(
    async (task: ScheduledTask): Promise<void> => {
      if (!window.confirm(`"${task.name}" görevi silinsin mi?`)) return
      setBusyId(task.id)
      setError(null)
      try {
        const result = await api.scheduled.delete(task.id)
        if (!result.ok) {
          setError(result.error)
          return
        }
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [refresh]
  )

  if (loading) return <p className="muted">Görevler yükleniyor...</p>

  return (
    <div className="sched-panel">
      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      <div className="sched-head">
        <div>
          <h4>Zamanlanmış görevler</h4>
          <p className="muted sched-hint">
            Uygulama açıkken çalışır. Her çalışma yeni bir sohbet oturumu oluşturur ve
            yalnızca sohbet yanıtı üretir (araç çalıştırmaz).
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm((open) => !open)}>
          {showForm ? 'Vazgeç' : '+ Yeni görev'}
        </button>
      </div>

      {showForm && (
        <div className="sched-form">
          <label className="field">
            <span>Görev adı</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sabah özeti"
              maxLength={100}
            />
          </label>
          <label className="field">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Bugünün planını özetle ve öncelikleri sırala..."
              rows={3}
            />
          </label>
          <label className="field">
            <span>Model</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {chatModels.length === 0 && <option value="">Sohbet modeli yok</option>}
              {chatModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Zamanlama</span>
            <div className="sched-kinds">
              {(Object.keys(KIND_LABELS) as ScheduleKind[]).map((value) => (
                <button
                  key={value}
                  className={kind === value ? 'active' : ''}
                  onClick={() => setKind(value)}
                  type="button"
                >
                  {KIND_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          {kind === 'once' && (
            <label className="field">
              <span>Tarih ve saat</span>
              <input
                type="datetime-local"
                value={onceAt}
                onChange={(event) => setOnceAt(event.target.value)}
              />
            </label>
          )}
          {kind === 'interval' && (
            <label className="field">
              <span>Aralık (dakika)</span>
              <input
                type="number"
                min={1}
                max={10080}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              />
            </label>
          )}
          {kind === 'daily' && (
            <label className="field">
              <span>Saat</span>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          )}

          <button
            className="btn"
            onClick={() => void create()}
            disabled={
              creating ||
              !name.trim() ||
              !prompt.trim() ||
              !modelId ||
              (kind === 'once' && !onceAt)
            }
          >
            {creating ? 'Oluşturuluyor...' : 'Görevi oluştur'}
          </button>
        </div>
      )}

      <div className="sched-list">
        {tasks.length === 0 ? (
          <p className="muted">Henüz zamanlanmış görev yok.</p>
        ) : (
          tasks.map((task) => (
            <div className={`sched-task ${task.enabled ? '' : 'disabled'}`} key={task.id}>
              <div className="sched-task-head">
                <div className="sched-task-title">
                  <strong>{task.name}</strong>
                  <span className="sched-badge">{KIND_LABELS[task.kind]}</span>
                  {!task.enabled && <span className="sched-badge off">duraklatıldı</span>}
                </div>
                <div className="sched-task-actions">
                  <button
                    className="btn-ghost"
                    onClick={() => void runNow(task)}
                    disabled={busyId === task.id}
                  >
                    {busyId === task.id ? 'Çalışıyor...' : 'Şimdi çalıştır'}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => void toggle(task)}
                    disabled={busyId === task.id}
                  >
                    {task.enabled ? 'Duraklat' : 'Etkinleştir'}
                  </button>
                  <button
                    className="btn-ghost danger"
                    onClick={() => void remove(task)}
                    disabled={busyId === task.id}
                  >
                    Sil
                  </button>
                </div>
              </div>
              <p className="sched-prompt">{task.prompt}</p>
              <div className="sched-meta">
                <span>{scheduleText(task)}</span>
                <span>Model: {task.modelId}</span>
                {task.enabled && <span>Sonraki: {formatDate(task.nextRunAt)}</span>}
                {task.lastRunAt && <span>Son: {formatDate(task.lastRunAt)}</span>}
              </div>
              {task.lastError && <div className="ws-error">{task.lastError}</div>}
              {!task.lastError && task.lastResult && (
                <details className="sched-result">
                  <summary>Son sonuç</summary>
                  <pre>{task.lastResult}</pre>
                </details>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
