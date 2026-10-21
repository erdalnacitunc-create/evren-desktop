import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { SubagentTaskInfo, SubagentTaskStatus, SubagentType } from '../../shared/types'

interface TaskRecord {
  info: SubagentTaskInfo
  cancel?: () => void
  waiters: Array<(info: SubagentTaskInfo) => void>
}

type ResumeHandler = (
  info: SubagentTaskInfo,
  controller: AbortController
) => Promise<{ ok: boolean; content: string }>

const tasks = new Map<string, TaskRecord>()
let persistChain: Promise<void> = Promise.resolve()
let initialized = false
let resumeHandler: ResumeHandler | null = null

function storeFile(): string {
  return join(app.getPath('userData'), 'subagent-tasks.json')
}

async function persistTasks(): Promise<void> {
  const snapshot = JSON.stringify(
    [...tasks.values()].map((record) => record.info).slice(0, 100),
    null,
    2
  )
  const target = storeFile()
  const temp = `${target}.tmp`
  persistChain = persistChain
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await fs.writeFile(temp, snapshot, 'utf8')
      await fs.rename(temp, target)
    })
    .catch((error) => {
      console.error('Alt-ajan görevleri kaydedilemedi:', error)
    })
  return persistChain
}

export async function initSubagentTaskStore(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const raw = await fs.readFile(storeFile(), 'utf8')
    const parsed = JSON.parse(raw) as SubagentTaskInfo | SubagentTaskInfo[]
    const list = Array.isArray(parsed) ? parsed : [parsed]
    let changed = false
    for (const info of list) {
      if (!info || typeof info.id !== 'string') continue
      if (info.status === 'running') {
        info.status = 'interrupted'
        info.finishedAt = Date.now()
        info.error = 'Uygulama yeniden başlatıldı; görev kesintiye uğradı.'
        changed = true
      }
      tasks.set(info.id, { info, waiters: [] })
    }
    if (changed) await persistTasks()
  } catch {
    // ilk çalıştırma
  }
}

function notify(record: TaskRecord): void {
  const waiters = record.waiters.splice(0)
  for (const waiter of waiters) waiter({ ...record.info })
}

function broadcastTask(info: SubagentTaskInfo): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('chat:event', {
      requestId: info.requestId,
      type: 'subagent-task',
      task: info
    })
  }
}

export function setSubagentResumeHandler(handler: ResumeHandler): void {
  resumeHandler = handler
}

function prune(): void {
  const finished = [...tasks.values()]
    .filter((record) => record.info.status !== 'running')
    .sort((left, right) => left.info.createdAt - right.info.createdAt)
  while (finished.length > 40) {
    const oldest = finished.shift()
    if (oldest) tasks.delete(oldest.info.id)
  }
}

export function createSubagentTask(
  input: {
    id: string
    requestId: string
    sessionId?: string
    agentType: SubagentType
    prompt: string
    model?: string
    workspaceRoot?: string | null
  },
  cancel?: () => void
): SubagentTaskInfo {
  const info: SubagentTaskInfo = {
    id: input.id,
    requestId: input.requestId,
    sessionId: input.sessionId,
    agentType: input.agentType,
    prompt: input.prompt,
    model: input.model,
    workspaceRoot: input.workspaceRoot,
    status: 'running',
    createdAt: Date.now(),
    attempts: 1,
    lastAttemptAt: Date.now()
  }
  tasks.set(info.id, { info, cancel, waiters: [] })
  void persistTasks()
  return { ...info }
}

export function updateSubagentTask(
  id: string,
  patch: Partial<
    Pick<SubagentTaskInfo, 'status' | 'finishedAt' | 'result' | 'error'>
  >
): SubagentTaskInfo | null {
  const record = tasks.get(id)
  if (!record) return null
  Object.assign(record.info, patch)
  if (patch.status && patch.status !== 'running' && !record.info.finishedAt) {
    record.info.finishedAt = Date.now()
  }
  notify(record)
  if (record.info.status !== 'running') prune()
  void persistTasks()
  return { ...record.info }
}

export function getSubagentTask(id: string): SubagentTaskInfo | null {
  const record = tasks.get(id)
  return record ? { ...record.info } : null
}

export function listSubagentTasks(sessionId?: string): SubagentTaskInfo[] {
  return [...tasks.values()]
    .map((record) => record.info)
    .filter((info) => !sessionId || info.sessionId === sessionId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((info) => ({ ...info }))
}

export function waitForSubagentTask(
  id: string,
  timeoutMs = 90_000
): Promise<SubagentTaskInfo | null> {
  const record = tasks.get(id)
  if (!record) return Promise.resolve(null)
  if (record.info.status !== 'running') return Promise.resolve({ ...record.info })

  return new Promise((resolve) => {
    let settled = false
    const finish = (info: SubagentTaskInfo | null): void => {
      if (settled) return
      settled = true
      resolve(info)
    }
    const timer = setTimeout(() => finish({ ...record.info }), Math.max(1000, timeoutMs))
    record.waiters.push((info) => {
      clearTimeout(timer)
      finish(info)
    })
  })
}

export function cancelSubagentTask(id: string): boolean {
  const record = tasks.get(id)
  if (!record || record.info.status !== 'running') return false
  record.cancel?.()
  record.info.status = 'cancelled'
  record.info.finishedAt = Date.now()
  notify(record)
  void persistTasks()
  return true
}

export function retrySubagentTask(id: string): SubagentTaskInfo | null {
  const record = tasks.get(id)
  if (!record || !resumeHandler || record.info.status === 'running') {
    return record ? { ...record.info } : null
  }

  const controller = new AbortController()
  record.cancel = () => controller.abort()
  Object.assign(record.info, {
    status: 'running' as SubagentTaskStatus,
    error: undefined,
    result: undefined,
    finishedAt: undefined,
    attempts: (record.info.attempts ?? 1) + 1,
    lastAttemptAt: Date.now()
  })
  notify(record)
  broadcastTask({ ...record.info })
  void persistTasks()

  void resumeHandler(record.info, controller)
    .then((result) => {
      if (controller.signal.aborted) {
        updateSubagentTask(id, { status: 'cancelled', finishedAt: Date.now() })
      } else {
        updateSubagentTask(id, {
          status: result.ok ? 'done' : 'error',
          result: result.ok ? result.content : undefined,
          error: result.ok ? undefined : result.content
        })
      }
    })
    .catch((error) => {
      updateSubagentTask(id, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        error: controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error)
      })
    })
    .finally(() => {
      const updated = getSubagentTask(id)
      if (updated) broadcastTask(updated)
    })

  return { ...record.info }
}

export async function resumeInterruptedSubagentTasks(maxAttempts = 2): Promise<number> {
  if (!resumeHandler) return 0
  const interrupted = [...tasks.values()]
    .filter(
      (record) =>
        record.info.status === 'interrupted' &&
        (record.info.attempts ?? 1) <= maxAttempts
    )
    .sort((left, right) => left.info.createdAt - right.info.createdAt)
  let started = 0
  for (const record of interrupted) {
    if (record.info.status === 'interrupted') {
      retrySubagentTask(record.info.id)
      started += 1
    }
  }
  return started
}
