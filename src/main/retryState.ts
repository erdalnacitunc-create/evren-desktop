/**
 * Kalıcı yeniden deneme durumu — OpenCode `Session.Message.Assistant.Retry`.
 *
 * ## Neden ayrı modül
 *
 * Aynı işi iki yol yapıyor: düz sohbet (`chat.ts`) ve ajan döngüsü
 * (`agent/loop.ts`, ayrıca işçi süreci). İki kopya olduğu için ikisinde de
 * aynı hata vardı ve canlı koşuda ortaya çıktı:
 *
 *  3 retry oldu (`Model şu anda dolu`) ama `sessions.json` içinde hiç
 *  `retry` alanı oluşmadı.
 *
 * Sebep: asistan mesajı akış **bitince** yazılıyor, retry bilgisi ise akış
 * **sürerken** gerekiyor. Mesaj aranıp bulunamayınca yazma sessizce boşa
 * gidiyordu.
 *
 * ## Davranış
 *
 * - `retry` verilmiş ve mesaj yoksa: **yer tutucu** asistan mesajı açılır.
 *   (OpenCode da asistan mesajını akış başında oluşturur.)
 * - Mesaj varsa: `retry` yazılır ya da (`retry: null`) temizlenir.
 * - `retry: null` ve mesaj yoksa: yapılacak bir şey yok.
 * - Hata olsa bile **fırlatmaz**: kayıt başarısız olsa da akış sürer.
 */

import { randomUUID } from 'crypto'
import type { StoredRetry, StoredMessage } from '../shared/types'
import { sessions } from './sessionRepository'

export interface RetryPatch {
  retry?: StoredRetry | null
  continuations?: number
}

export async function persistRetryState(
  sessionId: string | undefined,
  requestId: string,
  patch: RetryPatch
): Promise<void> {
  if (!sessionId) return
  try {
    const store = await sessions()
    const session = await store.get(sessionId)
    if (!session) return

    const existing = session.messages.find((message) => message.requestId === requestId)

    if (!existing) {
      // Yer tutucu yalnızca gerçek bir retry bilgisi varsa açılır; temizleme
      // isteği (`retry: null`) boş mesaj yaratmamalı.
      if (!patch.retry) return
      await store.appendMessage(sessionId, {
        id: randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        finishReason: null,
        requestId,
        retry: patch.retry,
        ...(patch.continuations !== undefined ? { continuations: patch.continuations } : {})
      })
      return
    }

    const messages = session.messages.map((message) => {
      if (message.requestId !== requestId) return message
      const updated = { ...message }
      if (patch.retry === null) {
        delete updated.retry
      } else if (patch.retry) {
        updated.retry = patch.retry
      }
      if (patch.continuations !== undefined) {
        updated.continuations = patch.continuations
      }
      return updated
    })
    await store.patch(sessionId, { messages })
  } catch {
    // kayıt başarısız olsa da akış devam eder
  }
}

/**
 * Başarısız turda metinsiz yer tutucuyu siler.
 *
 * Yer tutucu yalnızca retry sırasında açılır; akış hiç metin üretmeden
 * hata verirse geride boş bir asistan balonu kalmamalı.
 */
export async function dropEmptyPlaceholder(
  sessionId: string | undefined,
  requestId: string
): Promise<void> {
  if (!sessionId) return
  try {
    const store = await sessions()
    const session = await store.get(sessionId)
    if (!session) return
    const placeholder = session.messages.find((message) => message.requestId === requestId)
    if (!placeholder) return
    if (placeholder.content || placeholder.reasoning) return
    await store.patch(sessionId, {
      messages: session.messages.filter((message) => message.requestId !== requestId)
    })
  } catch {
    // yoksay
  }
}
