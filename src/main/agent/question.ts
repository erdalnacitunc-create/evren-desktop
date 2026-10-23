type Resolver = (answers: string[] | null) => void

const pending = new Map<string, Resolver>()

function keyFor(requestId: string, questionId: string): string {
  return `${requestId}::${questionId}`
}

export function waitForQuestion(
  requestId: string,
  questionId: string,
  signal: AbortSignal
): Promise<string[] | null> {
  const key = keyFor(requestId, questionId)
  return new Promise<string[] | null>((resolve) => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    pending.set(key, resolve)
    signal.addEventListener(
      'abort',
      () => {
        pending.delete(key)
        resolve(null)
      },
      { once: true }
    )
  })
}

export function resolveQuestion(
  requestId: string,
  questionId: string,
  answers: string[]
): boolean {
  const key = keyFor(requestId, questionId)
  const resolver = pending.get(key)
  if (!resolver) return false
  pending.delete(key)
  resolver(answers.map((answer) => String(answer)).filter(Boolean))
  return true
}

export function rejectAllQuestions(requestId: string): void {
  for (const [key, resolver] of pending) {
    if (key.startsWith(`${requestId}::`)) {
      pending.delete(key)
      resolver(null)
    }
  }
}
