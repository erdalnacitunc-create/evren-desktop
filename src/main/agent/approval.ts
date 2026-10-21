type Resolver = (approved: boolean) => void

const pending = new Map<string, Resolver>()

export function approvalKey(requestId: string, toolCallId: string): string {
  return `${requestId}::${toolCallId}`
}

export function waitForApproval(key: string, controller: AbortController): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (controller.signal.aborted) {
      resolve(false)
      return
    }
    pending.set(key, resolve)
    controller.signal.addEventListener(
      'abort',
      () => {
        pending.delete(key)
        resolve(false)
      },
      { once: true }
    )
  })
}

export function resolveApproval(key: string, approved: boolean): boolean {
  const resolver = pending.get(key)
  if (!resolver) return false
  pending.delete(key)
  resolver(approved)
  return true
}

export function rejectAllForRequest(requestId: string): void {
  for (const [key, resolver] of pending) {
    if (key.startsWith(`${requestId}::`)) {
      pending.delete(key)
      resolver(false)
    }
  }
}
