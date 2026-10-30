/**
 * Çalışan bir ajan isteğine araya girme (steering) kuyruğu.
 *
 * Kullanıcı yanıt sürerken mesaj yazarsa metin burada birikir; ajan döngüsü
 * bir sonraki adıma veya araç çağrısına geçmeden önce kuyruğu boşaltır ve
 * metni konuşmaya kullanıcı mesajı olarak ekler.
 *
 * Düz akışlarda (ajan kapalı) araya girme yoktur; renderer o durumda mesajı
 * sıraya alır ve yanıt bitince gönderir.
 */

const pending = new Map<string, string[]>()

export const MAX_STEERING_MESSAGES = 20
const MAX_STEERING_LENGTH = 8000

/** İsteğe araya girme mesajı ekler. Boş metin yok sayılır. */
export function pushSteering(requestId: string, text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const current = pending.get(requestId) ?? []
  if (current.length >= MAX_STEERING_MESSAGES) return false
  current.push(trimmed.slice(0, MAX_STEERING_LENGTH))
  pending.set(requestId, current)
  return true
}

/** Bekleyen mesajları sırayla döndürür ve kuyruğu temizler. */
export function drainSteering(requestId: string): string[] {
  const current = pending.get(requestId)
  if (!current || current.length === 0) return []
  pending.delete(requestId)
  return current
}

export function countSteering(requestId: string): number {
  return pending.get(requestId)?.length ?? 0
}

export function clearSteering(requestId: string): void {
  pending.delete(requestId)
}

export function clearAllSteering(): void {
  pending.clear()
}
