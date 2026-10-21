import type { ThemeMode } from '@shared/types'

export type ResolvedTheme = 'dark' | 'light'

export function resolveTheme(mode: ThemeMode | undefined): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return 'dark'
}

export function applyTheme(mode: ThemeMode | undefined): ResolvedTheme {
  const resolved = resolveTheme(mode)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  try {
    window.localStorage.setItem('evren-theme-mode', mode ?? 'dark')
  } catch {
    // localStorage kapalıysa yoksay
  }
  return resolved
}
