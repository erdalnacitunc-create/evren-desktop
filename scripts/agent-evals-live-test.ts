/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../src/main/agent/loop'
import { createRecordingSink } from '../src/main/agent/eventSink'
import { listMemories } from '../src/main/memory/store'
import {
  buildJudgePrompt,
  combineResult,
  parseJudgeResponse,
  summarizeEvals,
  type BasicResult,
  type EvalRunResult
} from '../src/main/agent/evalRunner'
import { EVAL_CASES, evidenceFromTools } from './evals/cases'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatRequest, ToolResultInfo } from '../src/shared/types'

/**
 * OpenAI Evals paterninin canlı uygulaması.
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-evals-live-test.ts
 *
 * ## Ne yapar
 *
 * Her eval senaryosunu **gerçek ajanla** koşturur, sonra iki katmanda puanlar:
 * 1. Kural tabanlı (`cases.ts` içindeki `checks`).
 * 2. LLM hakem (rubrik: doğruluk, kanıt, tamlık, dürüstlük, verimlilik).
 *
 * ## Maliyet denetimi
 *
 * Hakem çağrıları da token yakar. `EVREN_EVAL_JUDGE=0` ile kapatılabilir;
 * varsayılan açık çünkü kalite ölçümünün yarısı hakemden geliyor.
 *
 * ## Eşikler
 *
 * Senaryo geçme eşiği 0.7. Toplam özet en zayıf ölçütü de raporlar — asıl
 * iyileştirme oradan başlar.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

const MODEL = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'
const JUDGE_ENABLED = process.env.EVREN_EVAL_JUDGE !== '0'
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let settings: Awaited<ReturnType<typeof getSettings>>
let apiKey: string

function emptyDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

/** Tek senaryoyu koşturur ve çıktıyı toplar. */
async function runCase(
  evalCase: (typeof EVAL_CASES)[number],
  index: number
): Promise<{ output: string; toolResults: Array<{ name: string; ok: boolean; content: string }>; seconds: number; error?: string }> {
  const sink = createRecordingSink()
  const startedAt = Date.now()
  const payload = {
    model: MODEL,
    messages: [{ role: 'user', content: evalCase.prompt }],
    agent: {
      enabled: true,
      mode: 'auto',
      profile: 'build',
      browser: false,
      computer: false,
      workspace: evalCase.workspace !== null
    }
  } as ChatRequest

  const exec = () =>
    runAgent({
      requestId: `eval-${evalCase.id}-${Date.now()}-${index}`,
      webContentsId: 0,
      baseUrl: settings.baseUrl,
      apiKey,
      payload,
      controller: new AbortController(),
      sink,
      settings,
      workspaceRoot: evalCase.workspace
    })

  try {
    if (evalCase.workspace) await runWithWorkspace(evalCase.workspace, exec)
    else await exec()
  } catch (error) {
    return {
      output: '',
      toolResults: [],
      seconds: Math.round((Date.now() - startedAt) / 1000),
      error: error instanceof Error ? error.message : String(error)
    }
  }

  // Arka plan ajanları bitsin (en fazla 8 dk).
  for (let step = 0; step < 480; step += 1) {
    const running = sink.events.filter(
      (event) =>
        event.type === 'subagent-task' &&
        (event as { task?: { status?: string } }).task?.status === 'running'
    ).length
    if (running === 0) break
    await sleep(1000)
  }
  await sleep(300)

  const output = sink.events
    .filter((event) => event.type === 'content')
    .map((event) => (event as { text: string }).text)
    .join('')
  const toolResults = sink.events
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event as { result?: ToolResultInfo }).result)
    .filter((result): result is ToolResultInfo => Boolean(result))
    .map((result) => ({ name: result.name, ok: result.ok, content: String(result.content) }))

  return { output, toolResults, seconds: Math.round((Date.now() - startedAt) / 1000) }
}

/**
 * LLM hakem çağrısı.
 *
 * ## Neden `/v1/chat/completions`
 *
 * 0.4.22 eval koşusunda hakem **sessizce boş döndü**: yanlış yol
 * (`/chat/completions`) 404 veriyordu ve hata yutuluyordu. Sonuç: beş
 * senaryonun beşinde de `hakem: -` — kalite ölçümünün yarısı kayıptı.
 *
 * ## Boş yanıt (0.4.23, 3. tur)
 *
 * Üç senaryoda model **boş içerik** döndürdü (`content: ""`). Bu da sessizdi:
 * `raw` boş olduğu için "ayrıştırılamadı" uyarısı bile çıkmıyordu. Artık:
 * - boş yanıt açıkça uyarı olarak yazılır,
 * - bir kez daha denenir (geçici sağlayıcı davranışı olabilir),
 * - sağlayıcı `reasoning_content` döndürdüyse oradan da okunur.
 */
async function judgeOnce(input: {
  title: string
  prompt: string
  output: string
  evidence: string
}): Promise<{ scores: Array<{ criterion: string; score: number; reason?: string }>; empty: boolean }> {
  const prompt = buildJudgePrompt(input)
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1400,
        // Hakem yaratıcı olmamalı: ölçüm tutarlılığı için düşük sıcaklık.
        temperature: 0
      })
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200)
      console.log(`  (uyarı: hakem HTTP ${response.status} — ${detail})`)
      return { scores: [], empty: false }
    }
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string }
        finish_reason?: string
      }>
    }
    const choice = payload.choices?.[0]
    const raw = String(choice?.message?.content ?? '')
    // Bazı modeller yanıtı `reasoning_content` içinde döndürür.
    const fallback = String(choice?.message?.reasoning_content ?? '')
    const scores = parseJudgeResponse(raw.length > 0 ? raw : fallback)
    if (scores.length === 0) {
      const finish = choice?.finish_reason ?? '?'
      console.log(
        raw.trim().length === 0 && fallback.trim().length === 0
          ? `  (uyarı: hakem boş yanıt — finish_reason=${finish})`
          : `  (uyarı: hakem yanıtı ayrıştırılamadı — finish_reason=${finish}: ` +
            `${(raw || fallback).slice(0, 100)})`
      )
    }
    return { scores, empty: raw.trim().length === 0 && fallback.trim().length === 0 }
  } catch (error) {
    console.log(
      `  (uyarı: hakem çağrısı başarısız — ${error instanceof Error ? error.message : String(error)})`
    )
    return { scores: [], empty: false }
  }
}

async function judge(input: {
  title: string
  prompt: string
  output: string
  evidence: string
}): Promise<{ criterion: string; score: number; reason?: string }[]> {
  if (!JUDGE_ENABLED) return []
  const first = await judgeOnce(input)
  if (first.scores.length > 0) return first.scores
  // Boş yanıt geçici olabilir: tek bir tekrar denemesi yap (maliyet sınırlı).
  if (first.empty) {
    console.log('  (bilgi: hakem yeniden deneniyor)')
    const second = await judgeOnce(input)
    return second.scores
  }
  return []
}

app.whenReady().then(async () => {
  settings = await getSettings()
  const key = await loadApiKey()
  if (!key) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(3)
    return
  }
  apiKey = key

  const memories = await listMemories().catch(() => [])
  console.log(`model: ${MODEL} · hakem: ${JUDGE_ENABLED ? 'açık' : 'kapalı'} · bellek: ${memories.length} kayıt`)
  emptyDir(join(dataDir, 'evals'))

  const results: EvalRunResult[] = []

  for (const [index, evalCase] of EVAL_CASES.entries()) {
    console.log(`\n${'='.repeat(70)}\n[${index + 1}/${EVAL_CASES.length}] ${evalCase.title}\n${'='.repeat(70)}`)
    const run = await runCase(evalCase, index)

    const basic: BasicResult[] = evalCase.checks.map((entry) => ({
      label: entry.label,
      passed: entry.test(run.output),
      weight: entry.weight ?? 1
    }))

    let judgeScores: Awaited<ReturnType<typeof judge>> = []
    if (evalCase.judge && JUDGE_ENABLED && run.output.trim().length > 0) {
      judgeScores = await judge({
        title: evalCase.title,
        prompt: evalCase.prompt,
        output: run.output,
        evidence: evidenceFromTools(run.toolResults)
      })
    }

    const combined = combineResult({
      id: evalCase.id,
      title: evalCase.title,
      output: run.output,
      basic,
      judge: judgeScores as never,
      passThreshold: evalCase.passThreshold,
      error: run.error
    })
    results.push(combined)

    console.log(`süre: ${run.seconds} sn · yanıt ${run.output.length} kr · araç ${run.toolResults.length}`)
    for (const item of basic) {
      console.log(`  ${item.passed ? 'PASS' : 'FAIL'} (w${item.weight}) ${item.label}`)
    }
    if (judgeScores.length > 0) {
      console.log(
        `  hakem: ${judgeScores.map((score) => `${score.criterion}=${score.score}`).join(' ')}`
      )
    }
    console.log(
      `  → basic ${combined.basicScore} · hakem ${combined.judgeScore ?? '-'} · ` +
        `skor ${combined.score} · ${combined.passed ? 'GEÇTİ' : 'KALDI'}`
    )
  }

  const summary = summarizeEvals(results)
  console.log(`\n${'='.repeat(70)}\nÖZET\n${'='.repeat(70)}`)
  console.log(`geçen: ${summary.passed}/${summary.total} · ortalama: ${summary.averageScore}`)
  if (summary.failedIds.length > 0) console.log(`kalanlar: ${summary.failedIds.join(', ')}`)
  if (summary.weakestCriterion) console.log(`en zayıf ölçüt: ${summary.weakestCriterion}`)

  // Hakem kapsaması: ölçümün yarısı sessizce kaybolmasın.
  const judgedIds = results.filter((result) => (result.judge?.length ?? 0) > 0).map((r) => r.id)
  const expectedJudge = EVAL_CASES.filter((evalCase) => evalCase.judge).map((evalCase) => evalCase.id)
  console.log(`hakem ölçülen: ${judgedIds.length}/${expectedJudge.length} senaryo`)
  if (JUDGE_ENABLED && judgedIds.length < expectedJudge.length) {
    console.log(`hakem ölçülemeyen: ${expectedJudge.filter((id) => !judgedIds.includes(id)).join(', ')}`)
  }

  let failed = 0
  function check(label: string, actual: unknown, expected: unknown): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (!ok) failed += 1
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
    )
  }

  console.log('')
  check('tüm senaryolar koştu', results.length, EVAL_CASES.length)
  check('en az %60 senaryo geçti', summary.passed >= Math.ceil(EVAL_CASES.length * 0.6), true)
  check('ortalama skor ≥ 0.7', summary.averageScore >= 0.7, true)
  check('dürüstlük senaryosu geçti', results.find((r) => r.id === 'durustluk')?.passed ?? false, true)
  check('uydurma uç nokta yok', results.find((r) => r.id === 'proje-ozeti')?.basic[0]?.passed ?? false, true)

  console.log(`\nTOTAL=5 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
