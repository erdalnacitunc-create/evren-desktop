import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PANEL_SPECS,
  clampForViewport,
  readStoredCollapsed,
  readStoredSize,
  resizeFromDrag,
  resizeFromKeyboard,
  writeStoredCollapsed,
  writeStoredSize,
  type PanelId
} from '../lib/panelLayout'

export interface ResizablePanelOptions {
  /**
   * Tutamağın panelin hangi kenarında olduğu.
   * - `start`: sol/üst kenar (sağa/aşağı sürüklemek büyütür) — sohbet listesi
   *   ve alt terminal böyle.
   * - `end`: sağ/alt kenar (sola/yukarı sürüklemek büyütür) — sağ paneller.
   */
  edge?: 'start' | 'end'
  /** Ölçüm ekseni. Sağ/sol paneller `x`, alt terminal `y`. */
  axis?: 'x' | 'y'
  /**
   * Diğer panellerin kapladığı alanı döndürür (px). Sohbet kolonuna yer
   * bırakmak için kullanılır.
   */
  chrome?: () => number
}

/**
 * Kenar paneli boyutu + gizleme durumu.
 *
 * Sürükleme, `document` üzerindeki global pointer dinleyicileriyle yapılır:
 * React'in sentetik olayları + pointer capture kombinasyonu pencere dışına
 * çıkınca ve hızlı hareketlerde olay kaybediyordu (canlı testte panel
 * sürüklemeye tepki vermiyordu).
 */
export function useResizablePanel(id: PanelId, options: ResizablePanelOptions = {}) {
  const spec = PANEL_SPECS[id]
  const edge = options.edge ?? 'end'
  const axis = options.axis ?? 'x'

  const [size, setSize] = useState<number>(() => {
    const stored = readStoredSize(id, spec) ?? spec.defaultSize
    const viewport =
      typeof window === 'undefined' ? 0 : axis === 'x' ? window.innerWidth : window.innerHeight
    return clampForViewport(stored, spec, viewport, options.chrome?.() ?? 0)
  })
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed(id))
  const [dragging, setDragging] = useState(false)

  // Güncel değerleri dinleyicilerde okumak için (closure bayatlaması).
  const sizeRef = useRef(size)
  sizeRef.current = size
  const dragRef = useRef<{ originSize: number; startPos: number } | null>(null)

  /**
   * Boyutu sınırlar. `chrome` diğer panellerin kapladığı alandır; sohbet
   * kolonuna her zaman `MIN_CHAT_WIDTH` kadar yer bırakılır.
   */
  const applySize = useCallback(
    (next: number, persist: boolean) => {
      const chrome = options.chrome?.() ?? 0
      const viewport = axis === 'x' ? window.innerWidth : window.innerHeight
      const clamped = clampForViewport(next, spec, viewport, chrome)
      sizeRef.current = clamped
      setSize(clamped)
      if (persist) writeStoredSize(id, clamped)
      return clamped
    },
    [axis, id, options, spec]
  )

  const reset = useCallback(() => {
    applySize(spec.defaultSize, true)
  }, [applySize, spec.defaultSize])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous
      writeStoredCollapsed(id, next)
      return next
    })
  }, [id])

  const setCollapsedValue = useCallback(
    (value: boolean) => {
      setCollapsed(value)
      writeStoredCollapsed(id, value)
    },
    [id]
  )

  // Pencere küçülünce panel de küçülsün.
  useEffect(() => {
    const onResize = (): void => {
      const chrome = options.chrome?.() ?? 0
      const viewport = axis === 'x' ? window.innerWidth : window.innerHeight
      const next = clampForViewport(sizeRef.current, spec, viewport, chrome)
      if (next !== sizeRef.current) {
        sizeRef.current = next
        setSize(next)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [axis, options, spec])

  /**
   * Sürükleme başlatır. Dinleyiciler `document` üzerine eklenir ve pointer
   * pencere dışına çıksa da olaylar alınmaya devam eder.
   */
  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.currentTarget.focus?.()
      dragRef.current = {
        originSize: sizeRef.current,
        startPos: axis === 'x' ? event.clientX : event.clientY
      }
      setDragging(true)
      document.body.classList.add('panel-resizing')

      const onMove = (moveEvent: PointerEvent): void => {
        const drag = dragRef.current
        if (!drag) return
        const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
        const delta = position - drag.startPos
        applySize(resizeFromDrag(drag.originSize, delta, edge, spec), false)
      }

      const finish = (): void => {
        dragRef.current = null
        setDragging(false)
        document.body.classList.remove('panel-resizing')
        writeStoredSize(id, sizeRef.current)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    },
    [applySize, axis, edge, id, spec]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Home') {
        event.preventDefault()
        reset()
        return
      }
      const next = resizeFromKeyboard(
        sizeRef.current,
        event.key,
        edge,
        spec,
        undefined,
        event.shiftKey ? 64 : 16
      )
      if (next === null) return
      event.preventDefault()
      applySize(next, true)
    },
    [applySize, edge, reset, spec]
  )

  useEffect(() => {
    return () => document.body.classList.remove('panel-resizing')
  }, [])

  return {
    size,
    collapsed,
    dragging,
    setSize: applySize,
    reset,
    toggleCollapsed,
    setCollapsed: setCollapsedValue,
    /** Panele verilecek stil: genişlik + esneme tabanı. */
    style: collapsed
      ? ({ display: 'none' } as const)
      : axis === 'x'
        ? ({ flex: `0 0 ${size}px`, width: size, minWidth: spec.minSize } as const)
        : ({ flex: `0 0 ${size}px`, height: size, minHeight: spec.minSize } as const),
    handleProps: {
      dragging,
      orientation: axis === 'x' ? ('vertical' as const) : ('horizontal' as const),
      onPointerDown: startDrag,
      onKeyDown,
      onDoubleClick: reset
    }
  }
}
