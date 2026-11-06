import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

/**
 * Panel ayırıcı tutamağı.
 *
 * Görünmez geniş bir tıklama alanı (7 px) + üzerine gelince beliren ince
 * çizgi. Modern editörlerdeki (VS Code, Zed, Linear) davranış: sürükle,
 * çift tıkla varsayılana dön, klavye oklarıyla ince ayar.
 */
export function ResizeHandle({
  dragging,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
  label = 'Paneli yeniden boyutlandır',
  orientation = 'vertical'
}: {
  dragging: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  label?: string
  orientation?: 'vertical' | 'horizontal'
}) {
  return (
    <div
      className={`resize-handle resize-handle-${orientation}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      title="Sürükle: boyutlandır · Çift tık: varsayılan"
    >
      <span className="resize-handle-grip" aria-hidden="true" />
    </div>
  )
}
