import { shell } from 'electron'

/**
 * Yalnizca http(s) URL'lerini sistem tarayicisinda acar.
 * file:, javascript:, data: gibi tehlikeli semalar reddedilir.
 */
export async function openExternalSafe(raw: string): Promise<boolean> {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
}
