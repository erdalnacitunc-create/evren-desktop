/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { countWords, runSubagent } from '../src/main/agent/subagent'
import { runWithWorkspace } from '../src/main/workspace'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'
import type { ChatEvent } from '../src/shared/types'

/**
 * Alt ajan rapor bütçesinin canlı ölçümü (0.4.19).
 * Çalıştırma: node scripts/run-unit.cjs scripts/subagent-report-live-test.ts
 *
 * ## Ölçülen (0.4.18 temel çizgisi)
 *
 * Üç fazlı koşuda: adım başına ortalama **88 sn**, araç payı **<%2**,
 * en uzun tek adım **503 sn**, faz 2'de **3/3 kısmi**. Zaman araçlarda değil,
 * modelin tek parçada 4-8 bin karakterlik rapor üretmesinde.
 *
 * ## Bu test neyi ölçer
 *
 * Aynı projede üç paralel `explore` ajanı çalıştırır ve her biri için:
 * - rapor kelime sayısı (hedef: ≤ ~470),
 * - toplam süre,
 * - adım başına ortalama süre,
 * - kısmi sonuç oranı.
 *
 * Eşikler temel çizgiye göre: kelime ≤ 550, adım ortalaması ≤ 60 sn,
 * kısmi oran ≤ 1/3.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

const MODEL = 'deepseek-v4.1-flash'
const WORKSPACE = 'C:\\Users\\erdal\\Desktop\\wifi klima'

const TASKS = [
  {
    description: 'Firmware protokol katmanı',
    prompt:
      'src/ altındaki ESP8266 firmware dosyalarını incele. Haier seri protokolünün ' +
      'çerçeve yapısını, CRC algoritmasını ve komut akışını dosya:satır referanslarıyla açıkla. ' +
      'Hangi dosya neyden sorumlu, veri nasıl akıyor?'
  },
  {
    description: 'Mobil uygulama katmanı',
    prompt:
      'mobil/lib/ altındaki Flutter dosyalarını incele. Ekran yapısını, durum yönetimini, ' +
      'yerel HTTP ile uzak MQTT yollarını ve devre kesici/iyimser güncelleme tasarımını ' +
      'dosya:satır referanslarıyla açıkla.'
  },
  {
    description: 'Risk ve güvenlik taraması',
    prompt:
      'Projede güvenlik ve bakım risklerini tara: kimlik doğrulama eksikliği, gömülü sabit ' +
      'parolalar, hata yönetimi boşlukları, sabit port/IP varsayımları. Her bulguyu ' +
      'dosya:satır ile ve etki derecesiyle (yüksek/orta/düşük) listele.'
  }
]

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

interface Measurement {
  description: string
  ok: boolean
  partial: boolean
  partialReason?: string
  seconds: number
  words: number
  chars: number
  toolCalls: number
  stepTimes: number[]
  avgStepSeconds: number
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(3)
    return
  }

  console.log(`model: ${MODEL}`)
  console.log(`çalışma alanı: ${WORKSPACE}`)
  console.log(`görev: ${TASKS.length} paralel explore\n`)

  const measurements: Measurement[] = []

  await runWithWorkspace(WORKSPACE, async () => {
    const startedAt = Date.now()
    const results = await Promise.all(
      TASKS.map(async (task, index) => {
        const taskStarted = Date.now()
        let toolCalls = 0
        let stepTimes: number[] = []
        let lastStepAt = taskStarted

        const send = (event: ChatEvent): void => {
          if (event.type === 'tool-call') toolCalls += 1
        }

        // Adım süreleri `onProgress` ile gelir; her çağrı yeni bir adımdır.
        let lastStepNumber = 0
        const onProgress = (progress: { step: number; toolCalls: number }): void => {
          if (progress.step > lastStepNumber) {
            const now = Date.now()
            stepTimes.push(Math.round((now - lastStepAt) / 1000))
            lastStepAt = now
            lastStepNumber = progress.step
          }
        }

        const result = await runSubagent({
          parentRequestId: `report-live-${index}`,
          baseUrl: settings.baseUrl,
          apiKey: apiKey as string,
          model: MODEL,
          agentType: 'explore',
          prompt: task.prompt,
          workspaceRoot: WORKSPACE,
          mode: 'auto',
          profile: 'build',
          controller: new AbortController(),
          send,
          subagentTaskId: `sub-report-${index}`,
          description: task.description,
          onProgress
        })

        const seconds = Math.round((Date.now() - taskStarted) / 1000)
        const words = countWords(result.content)
        const deltas = stepTimes.slice(1)
        const avgStepSeconds = deltas.length
          ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
          : seconds

        return {
          description: task.description,
          ok: result.ok,
          partial: result.partial === true,
          partialReason: result.partialReason,
          seconds,
          words,
          chars: result.content.length,
          toolCalls,
          stepTimes: deltas,
          avgStepSeconds
        } satisfies Measurement
      })
    )
    measurements.push(...results)
    void startedAt
  })

  console.log('=== ÖLÇÜM ===\n')
  for (const m of measurements) {
    console.log(
      `${m.description.padEnd(28)} ${String(m.seconds).padStart(4)}sn · ` +
        `${String(m.words).padStart(4)} kelime · ${String(m.chars).padStart(5)} kr · ` +
        `araç ${String(m.toolCalls).padStart(2)} · adım ort. ${String(m.avgStepSeconds).padStart(3)}sn · ` +
        `${m.partial ? `KISMİ (${m.partialReason})` : 'tam'}`
    )
    if (m.stepTimes.length > 0) {
      console.log(`   adım aralıkları (sn): ${m.stepTimes.join(', ')}`)
    }
  }

  const totalWords = measurements.reduce((sum, m) => sum + m.words, 0)
  const avgWords = Math.round(totalWords / measurements.length)
  const avgStep = Math.round(
    measurements.reduce((sum, m) => sum + m.avgStepSeconds, 0) / measurements.length
  )
  const partialCount = measurements.filter((m) => m.partial).length
  const maxSeconds = Math.max(...measurements.map((m) => m.seconds))

  console.log(
    `\nortalama: ${avgWords} kelime · adım ort. ${avgStep}sn · ` +
      `kısmi ${partialCount}/${measurements.length} · en uzun ${maxSeconds}sn`
  )
  console.log('temel çizgi (0.4.18): adım ort. 88sn · kısmi 3/3 · en uzun 1297sn · kelime 400-900')

  // ===== iddialar =====
  check('tüm görevler tamam', measurements.every((m) => m.ok), true)
  check('her rapor 550 kelimenin altında', measurements.every((m) => m.words <= 550), true)
  check('ortalama adım süresi ≤ 60 sn', avgStep <= 60, true)
  check('kısmi oran en fazla 1/3', partialCount <= Math.floor(measurements.length / 3), true)
  check('raporlar boş değil', measurements.every((m) => m.words >= 80), true)

  console.log(`\nTOTAL=9 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
