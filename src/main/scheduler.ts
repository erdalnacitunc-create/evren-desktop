import { app, BrowserWindow, Notification } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduleKind,
  StoredMessage
} from '../shared/types'
import { listModels } from './api'
import { buildBaseBody } from './chatShared'
import { loadApiKey } from './credentials'
import { appIconPath } from './appIcon'
import { appendMessage, createSession, renameSession } from './sessionStore'
import { getSettings } from './settings'
import { streamCompletion } from './sse'
import { createLogger } from './logger'

const log = createLogger('scheduler')

let tasks: ScheduledTask[] = []
let timer: NodeJS.Timeout | null = null
let loaded = false
let writeChain: Promise<void> = Promise.resolve()
const running = new Set<string>()

function storeFile(): string {
  return join(app.getPath('userData'), 'scheduled-tasks.json')
}

async function loadTasks(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await fs.readFile(storeFile(), 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as ScheduledTask[]
    tasks = Array.isArray(parsed) ? parsed : []
  } catch {
    tasks = []
  }
  // Geçmişte kalmış nextRunAt'leri normalize et
  const now = Date.now()
  for (const task of tasks) {
    if (task.enabled && task.nextRunAt === undefined) {
      task.nextRunAt = nextRunFor(task)
    }
    if (task.enabled && task.kind === 'once' && (!task.nextRunAt || task.nextRunAt < now - 60_000)) {
      task.nextRunAt = task.nextRunAt ?? now
    }
  }
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify(tasks, null, 2)
  const target = storeFile()
  const temp = `${target}.tmp`
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await fs.writeFile(temp, snapshot, 'utf8')
      await fs.rename(temp, target)
    })
    .catch((error) => log.error('Zamanlanmış görevler kaydedilemedi:', error))
  return writeChain
}

function nextRunFor(task: ScheduledTask, from = Date.now()): number | undefined {
  if (task.kind === 'once') return task.runAt
  if (task.kind === 'interval') {
    const minutes = Math.max(1, task.intervalMinutes ?? 60)
    return from + minutes * 60_000
  }
  if (task.kind === 'daily' && task.time) {
    const [hour, minute] = task.time.split(':').map(Number)
    const date = new Date(from)
    date.setHours(hour || 0, minute || 0, 0, 0)
    if (date.getTime() <= from) date.setDate(date.getDate() + 1)
    return date.getTime()
  }
  return undefined
}

function validateInput(input: ScheduledTaskInput): ScheduledTaskInput {
  const name = String(input.name ?? '').trim().slice(0, 100)
  const prompt = String(input.prompt ?? '').trim()
  if (!name) throw new Error('Görev adı boş olamaz.')
  if (!prompt) throw new Error('Prompt boş olamaz.')
  if (!['once', 'interval', 'daily'].includes(input.kind)) {
    throw new Error('Geçersiz zamanlama türü.')
  }
  const modelId = String(input.modelId ?? '').trim()
  if (!modelId) throw new Error('Model seçmelisiniz.')
  if (input.kind === 'once') {
    if (!Number.isFinite(input.runAt) || (input.runAt ?? 0) <= 0) {
      throw new Error('Tek seferlik görev için tarih/saat gerekli.')
    }
  }
  if (input.kind === 'interval') {
    const minutes = Number(input.intervalMinutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10_080) {
      throw new Error('Aralık 1–10080 dakika olmalı.')
    }
  }
  if (input.kind === 'daily') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time ?? ''))) {
      throw new Error('Günlük saat HH:mm biçiminde olmalı.')
    }
  }
  return {
    name,
    prompt,
    modelId,
    kind: input.kind as ScheduleKind,
    runAt: input.runAt,
    intervalMinutes: input.intervalMinutes,
    time: input.time,
    enabled: input.enabled !== false
  }
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  await loadTasks()
  return [...tasks].sort((left, right) => left.createdAt - right.createdAt)
}

export async function createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask> {
  await loadTasks()
  const valid = validateInput(input)
  const now = Date.now()
  const task: ScheduledTask = {
    id: `task-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: valid.name,
    prompt: valid.prompt,
    modelId: valid.modelId,
    kind: valid.kind,
    runAt: valid.runAt,
    intervalMinutes: valid.intervalMinutes,
    time: valid.time,
    enabled: valid.enabled !== false,
    createdAt: now,
    updatedAt: now,
    nextRunAt: nextRunFor({
      id: '',
      name: valid.name,
      prompt: valid.prompt,
      modelId: valid.modelId,
      kind: valid.kind,
      runAt: valid.runAt,
      intervalMinutes: valid.intervalMinutes,
      time: valid.time,
      enabled: true,
      createdAt: now,
      updatedAt: now
    })
  }
  tasks.push(task)
  await persist()
  return task
}

export async function updateScheduledTask(
  id: string,
  patch: Partial<ScheduledTaskInput> & { enabled?: boolean }
): Promise<ScheduledTask | null> {
  await loadTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) return null
  const merged = validateInput({
    name: patch.name ?? task.name,
    prompt: patch.prompt ?? task.prompt,
    modelId: patch.modelId ?? task.modelId,
    kind: (patch.kind ?? task.kind) as ScheduleKind,
    runAt: patch.runAt ?? task.runAt,
    intervalMinutes: patch.intervalMinutes ?? task.intervalMinutes,
    time: patch.time ?? task.time,
    enabled: patch.enabled ?? task.enabled
  })
  Object.assign(task, merged, {
    enabled: patch.enabled ?? task.enabled,
    updatedAt: Date.now()
  })
  task.nextRunAt = task.enabled ? nextRunFor(task) : undefined
  await persist()
  return task
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  await loadTasks()
  const index = tasks.findIndex((item) => item.id === id)
  if (index < 0) return false
  tasks.splice(index, 1)
  await persist()
  return true
}

async function executeTask(task: ScheduledTask): Promise<void> {
  if (running.has(task.id)) return
  running.add(task.id)
  try {
    const [key, settings] = await Promise.all([loadApiKey(), getSettings()])
    if (!key) throw new Error('API anahtarı bulunamadı.')
    let modelId = task.modelId
    if (!modelId) {
      const models = await listModels(settings.baseUrl, key)
      modelId = models.find((model) => model.task === 'chat' || model.task === 'vision_chat')?.id ?? ''
    }
    if (!modelId) throw new Error('Kullanılabilir sohbet modeli yok.')

    const session = await createSession(modelId)
    await renameSession(session.id, `Zamanlanmış: ${task.name}`)
    const userMessage: StoredMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: task.prompt,
      createdAt: Date.now()
    }
    await appendMessage(session.id, userMessage)

    const controller = new AbortController()
    const result = await streamCompletion(
      settings.baseUrl,
      key,
      buildBaseBody({
        model: modelId,
        messages: [
          {
            role: 'system',
            content:
              'Sen EVREN Desktop zamanlanmış görev ajanısın. Görevi kısa, net ve uygulanabilir biçimde yanıtla.'
          },
          { role: 'user', content: task.prompt }
        ]
      }),
      controller.signal,
      () => undefined
    )

    const assistantMessage: StoredMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: result.content || '(boş yanıt)',
      createdAt: Date.now(),
      usage: result.usage,
      finishReason: result.finishReason
    }
    await appendMessage(session.id, assistantMessage)
    task.lastRunAt = Date.now()
    task.lastResult = (result.content || '').slice(0, 3000)
    task.lastError = undefined
    task.nextRunAt = task.kind === 'once' ? undefined : nextRunFor(task)
    if (task.kind === 'once') task.enabled = false
    notify(`Zamanlanmış görev tamamlandı: ${task.name}`, result.content?.slice(0, 160))
  } catch (error) {
    task.lastRunAt = Date.now()
    task.lastError = error instanceof Error ? error.message : String(error)
    task.nextRunAt = task.kind === 'once' ? undefined : nextRunFor(task)
    if (task.kind === 'once') task.enabled = false
    notify(`Zamanlanmış görev başarısız: ${task.name}`, task.lastError)
  } finally {
    running.delete(task.id)
    await persist()
  }
}

function notify(title: string, body?: string): void {
  try {
    if (!Notification.isSupported()) return
    if (BrowserWindow.getAllWindows().some((window) => window.isFocused())) return
    new Notification({ title, body: body ?? '', icon: appIconPath() }).show()
  } catch {
    // bildirim desteklenmiyorsa yoksay
  }
}

async function tick(): Promise<void> {
  await loadTasks()
  const now = Date.now()
  for (const task of tasks) {
    if (!task.enabled || running.has(task.id)) continue
    const due = task.nextRunAt ?? (task.kind === 'once' ? task.runAt : nextRunFor(task, now))
    if (due !== undefined && due <= now) {
      void executeTask(task)
    }
  }
}

export async function startScheduler(): Promise<void> {
  await loadTasks()
  if (timer) return
  timer = setInterval(() => void tick(), 30_000)
  void tick()
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export async function runScheduledTaskNow(id: string): Promise<ScheduledTask | null> {
  await loadTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) return null
  await executeTask(task)
  return task
}
