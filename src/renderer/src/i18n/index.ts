import { useMemo, useSyncExternalStore } from 'react'
import type { Locale } from '../../../shared/types'
import { en } from './en'
import { tr, type TranslationKey } from './tr'

export const LOCALES: Locale[] = ['tr', 'en']

export const LOCALE_LABELS: Record<Locale, string> = {
  tr: 'Türkçe',
  en: 'English'
}

/** Sözlükler. Yeni dil eklendiğinde buraya ve `Locale` tipine eklenir. */
const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { tr, en }

export const DEFAULT_LOCALE: Locale = 'tr'

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<() => void>()

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value)
}

export function getLocale(): Locale {
  return current
}

/** Arayüz dilini değiştirir ve abone bileşenleri yeniden çizer. */
export function setLocale(locale: Locale): void {
  if (current === locale) return
  current = locale
  try {
    document.documentElement.lang = locale
  } catch {
    // DOM yoksa (test) sessizce geç
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Yer tutucuları (`{ad}`) verilen değerlerle doldurur. */
export function formatMessage(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Anahtarı geçerli dilde çözer.
 * Anahtar geçerli dilde yoksa Türkçeye, o da yoksa anahtarın kendisine düşer.
 */
export function translate(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: Locale = current
): string {
  const template = DICTIONARIES[locale]?.[key] ?? tr[key] ?? key
  return formatMessage(template, params)
}

/** Bileşen içinde kullanım: dil değişince otomatik yeniden çizilir. */
export function useI18n(): {
  locale: Locale
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  setLocale: (locale: Locale) => void
} {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale)
  return useMemo(
    () => ({
      locale,
      t: (key: TranslationKey, params?: Record<string, string | number>) =>
        translate(key, params, locale),
      setLocale
    }),
    [locale]
  )
}

/** Dil değişikliğini React dışından dinlemek için (test). */
export function onLocaleChange(listener: () => void): () => void {
  return subscribe(listener)
}

export type { TranslationKey }
