import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { SubagentTaskInfo, SubagentTaskStatus, SubagentType } from '../../shared/types'
import { createLogger } from '../logger'
import { logSubagent } from './subagentLog'

const log = createLogger('agent/taskManager')

interface TaskRecord {
  info: SubagentTaskInfo
  cancel?: () => void
  waiters: Array<(info: SubagentTaskInfo) => void>
}

type ResumeHandler = (
  info: SubagentTaskInfo,
  controller: AbortController
) => Promise<{
  ok: boolean
  content: string
  partial?: boolean
  partialReason?: 'steps' | 'tools' | 'deadline' | 'tool-timeout'
}>

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
      log.error('Alt-ajan görevleri kaydedilemedi:', error)
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
    description?: string
    ownedFiles?: string[]
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
    description: input.description,
    ownedFiles: input.ownedFiles,
    model: input.model,
    workspaceRoot: input.workspaceRoot,
    status: 'running',
    createdAt: Date.now(),
    attempts: 1,
    lastAttemptAt: Date.now()
  }
  tasks.set(info.id, { info, cancel, waiters: [] })
  logSubagent({
    phase: 'state',
    taskId: info.id,
    requestId: info.requestId,
    agentType: info.agentType,
    msg: 'görev oluşturuldu (running)',
    data: { description: info.description, model: info.model, promptLength: info.prompt.length }
  })
  void persistTasks()
  return { ...info }
}

export function updateSubagentTask(
  id: string,
  patch: Partial<
    Pick<
      SubagentTaskInfo,
      | 'status'
      | 'finishedAt'
      | 'result'
      | 'error'
      | 'partial'
      | 'partialReason'
      | 'progress'
      | 'attempts'
      | 'lastAttemptAt'
    >
  >
): SubagentTaskInfo | null {
  const record = tasks.get(id)
  if (!record) return null
  Object.assign(record.info, patch)
  if (patch.status && patch.status !== 'running' && !record.info.finishedAt) {
    record.info.finishedAt = Date.now()
  }
  // Durum geçişleri ayrıntılı günlüğe yazılır: "görev neden bitti / neden
  // hata verdi" sorusu `subagent-tasks.json`'dan değil, olay akışından
  // yanıtlanabilmeli.
  if (patch.status) {
    const elapsed = record.info.finishedAt
      ? record.info.finishedAt - record.info.createdAt
      : Date.now() - record.info.createdAt
    logSubagent({
      phase: 'state',
      level: patch.status === 'error' ? 'error' : patch.status === 'running' ? 'info' : 'info',
      taskId: id,
      requestId: record.info.requestId,
      agentType: record.info.agentType,
      msg: `durum → ${patch.status}`,
      data: {
        elapsedMs: elapsed,
        partial: record.info.partial ?? false,
        partialReason: record.info.partialReason,
        error: record.info.error?.slice(0, 500),
        resultLength: record.info.result?.length ?? 0
      }
    })
  }
  // Bekleyenleri YALNIZCA anlamlı bir değişimde uyandır. İlerleme
  // (`progress`) güncellemesi `task_wait`'i erken döndürürse model "hâlâ
  // çalışıyor" cevabını sonuç sanır; testte tam bu yakalandı.
  const wakesWaiters =
    Boolean(patch.status) || patch.result !== undefined || patch.error !== undefined
  if (wakesWaiters) notify(record)
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
    partial: undefined,
    partialReason: undefined,
    progress: undefined,
    finishedAt: undefined,
    attempts: (record.info.attempts ?? 1) + 1,
    lastAttemptAt: Date.now()
  })
  logSubagent({
    phase: 'resume',
    taskId: id,
    requestId: record.info.requestId,
    agentType: record.info.agentType,
    msg: 'görev yeniden başlatıldı',
    data: { attempts: record.info.attempts }
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
          error: result.ok ? undefined : result.content,
          partial: result.partial,
          partialReason: result.partialReason
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
