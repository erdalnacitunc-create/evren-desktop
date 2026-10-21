import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteAction {
  id: string
  label: string
  description?: string
  keywords?: string
  run: () => void
}

interface Props {
  open: boolean
  actions: PaletteAction[]
  onClose: () => void
}

export function GlobalCommandPalette({ open, actions, onClose }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    const rank = (action: PaletteAction): number => {
      const label = action.label.toLowerCase()
      if (label === needle) return 0
      if (label.startsWith(needle)) return 1
      if (label.includes(needle)) return 2
      const extra = `${action.description ?? ''} ${action.keywords ?? ''}`.toLowerCase()
      if (extra.includes(needle)) return 3
      return 99
    }
    return actions
      .map((action) => ({ action, score: rank(action) }))
      .filter((entry) => entry.score < 99)
      .sort(
        (left, right) =>
          left.score - right.score || left.action.label.localeCompare(right.action.label, 'tr')
      )
      .map((entry) => entry.action)
  }, [actions, query])

  if (!open) return null

  const run = (action: PaletteAction | undefined): void => {
    if (!action) return
    onClose()
    action.run()
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Komut paleti"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          placeholder="Komut ara... (ör. git, ayarlar, yeni sohbet)"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((current) => (filtered.length ? (current + 1) % filtered.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((current) =>
                filtered.length ? (current - 1 + filtered.length) % filtered.length : 0
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(filtered[index])
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <p className="palette-empty">Eşleşen komut yok.</p>
          ) : (
            filtered.map((action, itemIndex) => (
              <button
                key={action.id}
                className={`palette-item ${itemIndex === index ? 'active' : ''}`}
                onMouseEnter={() => setIndex(itemIndex)}
                onClick={() => run(action)}
              >
                <span className="palette-label">{action.label}</span>
                {action.description && (
                  <span className="palette-description">{action.description}</span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> gez · <kbd>Enter</kbd> çalıştır ·{' '}
            <kbd>Esc</kbd> kapat
          </span>
        </div>
      </div>
    </div>
  )
}
