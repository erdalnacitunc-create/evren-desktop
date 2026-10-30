/**
 * Besteci istem geçmişi (geri/ileri).
 *
 * Gönderilen istemler bir yığında tutulur. Kullanıcı `Alt+↑` ile önceki istemi
 * geri getirir, `Alt+↓` ile ileri gider; yığının sonunda yazmakta olduğu taslağa
 * döner. Saf fonksiyonlar: React'e bağımlı değildir.
 */

export interface PromptHistory {
  /** En eski → en yeni. */
  items: string[]
  /** -1 = taslak, aksi halde items içindeki konum. */
  index: number
  /** Kullanıcının gezinmeye başlamadan önce yazdığı metin. */
  draft: string
}

export const MAX_PROMPT_HISTORY = 100

export function emptyHistory(): PromptHistory {
  return { items: [], index: -1, draft: '' }
}

/** Hazır istem listesinden (örn. oturumdaki kullanıcı mesajları) geçmiş üretir. */
export function historyFromPrompts(prompts: string[]): PromptHistory {
  const items = prompts
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0)
    .slice(-MAX_PROMPT_HISTORY)
  return { items, index: -1, draft: '' }
}

/** Yeni gönderilen istemi kaydeder; aynı istemin art arda tekrarını atlar. */
export function recordPrompt(history: PromptHistory, prompt: string): PromptHistory {
  const text = prompt.trim()
  if (!text) return history
  const items = history.items.slice()
  if (items[items.length - 1] !== text) items.push(text)
  if (items.length > MAX_PROMPT_HISTORY) items.splice(0, items.length - MAX_PROMPT_HISTORY)
  return { items, index: -1, draft: '' }
}

/** Bir önceki istemi döndürür. Değişiklik yoksa aynı nesne döner. */
export function recallPrevious(history: PromptHistory, currentInput: string): PromptHistory {
  if (history.items.length === 0) return history
  if (history.index === -1) {
    return {
      items: history.items,
      index: history.items.length - 1,
      draft: currentInput
    }
  }
  if (history.index === 0) return history
  return { ...history, index: history.index - 1 }
}

/** Bir sonraki isteme, yığın sonunda taslağa döner. */
export function recallNext(history: PromptHistory): PromptHistory {
  if (history.index === -1) return history
  if (history.index >= history.items.length - 1) {
    return { items: history.items, index: -1, draft: history.draft }
  }
  return { ...history, index: history.index + 1 }
}

/** Geçmişte gezinme sonucunda besteciye yazılacak metin. */
export function currentPrompt(history: PromptHistory, currentInput: string): string {
  if (history.index === -1) return currentInput
  return history.items[history.index] ?? currentInput
}

export function canGoBack(history: PromptHistory): boolean {
  return history.items.length > 0 && history.index !== 0
}

export function canGoForward(history: PromptHistory): boolean {
  return history.index !== -1
}
