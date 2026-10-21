import { useMemo } from 'react'
import type { SlashCommand } from '@shared/types'

interface Props {
  commands: SlashCommand[]
  query: string
  activeIndex: number
  onSelect: (command: SlashCommand) => void
  onHover: (index: number) => void
}

export function CommandPalette({
  commands,
  query,
  activeIndex,
  onSelect,
  onHover
}: Props): React.JSX.Element | null {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? commands.filter(
          (command) =>
            command.name.toLowerCase().includes(needle) ||
            (command.description ?? '').toLowerCase().includes(needle) ||
            command.category.toLowerCase().includes(needle)
        )
      : commands
    return list.slice(0, 40)
  }, [commands, query])

  if (filtered.length === 0) return null

  return (
    <div className="command-palette">
      <div className="command-palette-head">
        <span>Komutlar</span>
        <span className="command-palette-hint">↑↓ seç · Enter çalıştır · Esc kapat</span>
      </div>
      <div className="command-list">
        {filtered.map((command, index) => (
          <button
            key={command.id}
            className={`command-item ${index === activeIndex ? 'active' : ''}`}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(command)
            }}
          >
            <span className="command-name">/{command.name}</span>
            <span className="command-description">{command.description}</span>
            <span className="command-category">{command.category}</span>
            {command.argumentHint && (
              <span className="command-args">{command.argumentHint}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
