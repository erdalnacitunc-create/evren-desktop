import type { ChatEvent, ChatUsage } from '../shared/types'

/**
 * Asistan yanıtı biriktiricisi.
 *
 * Saf mantık: Electron, dosya veya ağ erişimi yoktur. `chat.ts` her olayı
 * buradan geçirir; biriktirme ve "kaydedilmeli mi" kararı tek yerde toplanır.
 * Süreç ayrımında bu modül ajan sürecine, kayıt kararı ana sürece taşınabilir.
 */

export interface StreamState {
  content: string
  reasoning: string
  usage?: ChatUsage
  /** Oturuma kayıt denendi mi (tekrar denemeyi engeller). */
  persisted: boolean
}

export interface ApplyResult {
  state: StreamState
  /**
   * Kayıt denenmeli mi? `null` ise hayır.
   * Değer, kaydedilecek `finishReason` alanıdır.
   */
  persist: { finishReason: string | null } | null
}

export function emptyStreamState(): StreamState {
  return { content: '', reasoning: '', persisted: false }
}

/** Olay bu isteğe mi ait? Farklı isteklerin olayları biriktiriciye karışmamalı. */
export function belongsToRequest(event: ChatEvent, requestId: string): boolean {
  return event.requestId === requestId
}

/** Kaydedilecek anlamlı içerik var mı? */
export function hasPersistableContent(state: StreamState): boolean {
  return state.content.trim().length > 0 || state.reasoning.trim().length > 0
}

/**
 * Bir olayı duruma uygular ve yeni durumu döndürür.
 * Girdi durumu değiştirilmez (immutable), böylece test ve eşzamanlılık güvenli olur.
 */
export function applyStreamEvent(state: StreamState, event: ChatEvent): ApplyResult {
  switch (event.type) {
    case 'content': {
      if (!event.text) return { state, persist: null }
      return {
        state: { ...state, content: state.content + event.text },
        persist: null
      }
    }
    case 'reasoning': {
      if (!event.text) return { state, persist: null }
      return {
        state: { ...state, reasoning: state.reasoning + event.text },
        persist: null
      }
    }
    case 'usage':
      return { state: { ...state, usage: event.usage }, persist: null }
    case 'done':
    case 'error': {
      if (state.persisted) return { state, persist: null }
      if (!hasPersistableContent(state)) return { state, persist: null }
      const finishReason = event.type === 'done' ? event.finishReason : null
      return {
        state: { ...state, persisted: true },
        persist: { finishReason }
      }
    }
    default:
      // steering, tool-call, approval gibi olaylar biriktiriciyi etkilemez.
      return { state, persist: null }
  }
}
