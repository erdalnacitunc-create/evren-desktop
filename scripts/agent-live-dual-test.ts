/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatEvent, ChatRequest, SubagentTaskInfo } from '../src/shared/types'

/**
 * İki canlı sorgu: yerel proje + web.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-live-dual-test.ts
 *
 * Üretim yolu (runAgent) kullanılır; sahte sağlayıcı yoktur.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

interface RunStats {
  label: string
  durationMs: number
  retries: number
  toolCalls: Record<string, number>
  spawns: number
  subagentTasks: Array<{ id: string; status: string; agentType: string; ms: number; chars: number; partial?: string }>
  textLength: number
  finish: string | null
  errors: number
  text: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runQuery(options: {
  label: string
  prompt: string
  workspace: string | null
  model: string
  apiKey: string
  settings: Awaited<ReturnType<typeof getSettings>>
}): Promise<RunStats> {
  const sink = createRecordingSink()
  const startedAt = Date.now()
  const subagentStarts = new Map<string, number>()
  const subagentEnds = new Map<string, SubagentTaskInfo>()

  const requestId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    model: options.model,
    messages: [{ role: 'user', content: options.prompt }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: options.workspace !== null
    }
  } as ChatRequest

  const exec = () =>
    runAgent({
      requestId,
      webContentsId: 0,
      baseUrl: options.settings.baseUrl,
      apiKey: options.apiKey,
      payload,
      controller: new AbortController(),
      sink,
      settings: options.settings,
      workspaceRoot: options.workspace
    })

  if (options.workspace) {
    await runWithWorkspace(options.workspace, exec)
  } else {
    await exec()
  }

  // Arka plan alt ajanları bitene kadar bekle (en fazla 8 dk).
  for (let index = 0; index < 480; index += 1) {
    const running = sink.events.filter(
      (event) => event.type === 'subagent-task' && (event as { task?: SubagentTaskInfo }).task?.status === 'running'
    ).length
    const finished = sink.events.filter(
      (event) => event.type === 'subagent-task' && (event as { task?: SubagentTaskInfo }).task?.status !== 'running'
    ).length
    if (running === 0 && finished === 0) break
    if (running === 0) break
    await sleep(1000)
  }

  for (const event of sink.events) {
    if (event.type !== 'subagent-task') continue
    const task = (event as { task?: SubagentTaskInfo }).task
    if (!task) continue
    if (task.status === 'running') {
      if (!subagentStarts.has(task.id)) subagentStarts.set(task.id, task.createdAt)
    } else {
      subagentEnds.set(task.id, task)
    }
  }

  const toolCalls: Record<string, number> = {}
  let retries = 0
  let errors = 0
  for (const event of sink.events) {
    if (event.type === 'tool-call') {
      const name = (event as { call?: { name?: string } }).call?.name ?? '?'
      toolCalls[name] = (toolCalls[name] ?? 0) + 1
    }
    if (event.type === 'retry') retries += 1
    if (event.type === 'error') errors += 1
  }

  const text = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  const done = sink.events.find((event) => event.type === 'done') as
    | { finishReason?: string | null }
    | undefined

  const subagentTasks = [...subagentEnds.values()].map((task) => ({
    id: task.id.slice(0, 12),
    status: task.status,
    agentType: task.agentType,
    ms: task.finishedAt ? task.finishedAt - task.createdAt : 0,
    chars: String(task.result ?? '').length,
    partial: task.partial ? `${task.partialReason ?? 'partial'}` : undefined
  }))

  return {
    label: options.label,
    durationMs: Date.now() - startedAt,
    retries,
    toolCalls,
    spawns: toolCalls['spawn_agent'] ?? 0,
    subagentTasks,
    textLength: text.length,
    finish: done?.finishReason ?? null,
    errors,
    text
  }
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(0)
    return
  }
  const model = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'

  const runs: RunStats[] = []

  // ---------- SORGU 1: yerel klasör ----------
  console.log('\n' + '='.repeat(64))
  console.log('SORGU 1 — yerel plc_proje (çalışma alanı = plc_proje)')
  console.log('='.repeat(64))
  const q1 = await runQuery({
    label: 'plc_proje (yerel)',
    prompt:
      'Bu projeyi incele ve yapısı hakkında özet çıkar. Katmanları, modülleri ve ' +
      'her katmanın sorumluluğunu dosya referanslarıyla açıkla.',
    workspace: 'C:\\Users\\erdal\\Desktop\\plc_proje',
    model,
    apiKey,
    settings
  })
  runs.push(q1)
  report(q1)

  // ---------- SORGU 2: web ----------
  console.log('\n' + '='.repeat(64))
  console.log('SORGU 2 — web üzerinde plc_proje benzeri proje araştırması')
  console.log('='.repeat(64))
  const q2 = await runQuery({
    label: 'web (benzer proje)',
    prompt:
      'Webde araştır: ESP32 tabanlı, bulut bağlantılı, çok katmanlı bir PLC/otomasyon ' +
      'sistemi mimarisi nasıl kurulur? Benzer açık kaynak projeleri (GitHub) bul, ' +
      'katman ayrımı ve haberleşme protokolleri açısından karşılaştır. Kaynak URL ver.',
    workspace: null,
    model,
    apiKey,
    settings
  })
  runs.push(q2)
  report(q2)

  console.log('\n' + '='.repeat(64))
  console.log('KARŞILAŞTIRMA')
  console.log('='.repeat(64))
  for (const run of runs) {
    console.log(
      `${run.label.padEnd(22)} ${String(Math.round(run.durationMs / 1000)).padStart(4)}sn ` +
        `| retry ${String(run.retries).padStart(2)} | araç ${String(Object.values(run.toolCalls).reduce((a, b) => a + b, 0)).padStart(2)} ` +
        `| spawn ${run.spawns} | metin ${run.textLength}`
    )
  }

  app.exit(0)

  function report(stats: RunStats): void {
    console.log(`süre: ${Math.round(stats.durationMs / 1000)} sn`)
    console.log(`bitiş: ${stats.finish} | hata: ${stats.errors} | retry: ${stats.retries}`)
    console.log(`araç: ${JSON.stringify(stats.toolCalls)}`)
    console.log(`spawn_agent: ${stats.spawns}`)
    if (stats.subagentTasks.length > 0) {
      console.log('alt ajanlar:')
      for (const task of stats.subagentTasks) {
        console.log(
          `  ${task.agentType} ${task.status} ${Math.round(task.ms / 1000)}sn ${task.chars}kr ${task.partial ? '[' + task.partial + ']' : ''}`
        )
      }
    } else {
      console.log('alt ajanlar: yok')
    }
    console.log(`metin: ${stats.textLength} kr`)
    console.log('\n--- rapor (ilk 700) ---')
    console.log(stats.text.slice(0, 700))
  }
})
