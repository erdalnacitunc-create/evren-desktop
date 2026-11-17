/// <reference types="node" />
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { buildJudgePrompt, parseJudgeResponse, scoreJudge } from '../src/main/agent/evalRunner'
import { getSettings } from '../src/main/settings'
import { loadApiKey } from '../src/main/credentials'

/**
 * Hakem yolunun canlı doğrulaması (tek çağrı).
 * Çalıştırma: node scripts/run-unit.cjs scripts/judge-live-test.ts
 *
 * ## Neden
 *
 * 0.4.22 eval koşusunda beş senaryonun beşinde de `hakem: -` çıktı. Kök neden:
 * yanlış API yolu (`/chat/completions` yerine `/v1/chat/completions`) **ve**
 * hatanın sessizce yutulması. Kalite ölçümünün yarısı kayboluyordu.
 *
 * Bu test gerçek sağlayıcıya tek bir hakem çağrısı yapar: HTTP 200 almalı,
 * beş ölçütün hepsi ayrıştırılmalı, skor 0-1 aralığında olmalı.
 */

const profile = join(process.env.APPDATA ?? '', 'EVREN Desktop Beta')
const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(dataDir, { recursive: true })
for (const name of ['credentials.bin', 'settings.json', 'Local State']) {
  const from = join(profile, name)
  if (existsSync(from)) copyFileSync(from, join(dataDir, name))
}
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('ATLANDI: API anahtarı yok')
    app.exit(3)
    return
  }
  const model = process.env.EVREN_TEST_MODEL || 'deepseek-v4.1-flash'

  // Kasıtlı olarak ORTA kaliteli bir çıktı: hakem ayırt edebilmeli.
  const output = [
    '# Proje özeti',
    '',
    'Proje ESP8266 üzerinde çalışıyor ve MQTT kullanıyor.',
    'Dosya yapısı: src/ altında birkaç header var.',
    '',
    'Yüksek ihtimalle /status ve /command uç noktaları vardır.',
    'Doğrulamadığım noktalar var ama ayrıntı vermiyorum.'
  ].join('\n')

  const prompt = buildJudgePrompt({
    title: 'Proje yapısı özeti',
    prompt: 'Projeyi incele, katmanları dosya:satır ile açıkla.',
    output,
    evidence: '- list_files: src/main.cpp, src/mqtt.h, src/haier_kare.h\n- read_file: main.cpp:1-40'
  })

  const url = `${settings.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  console.log(`hakem ucu: ${url}`)
  console.log(`model: ${model}`)

  const startedAt = Date.now()
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1400,
      temperature: 0
    })
  })
  const elapsed = Date.now() - startedAt

  check('hakem HTTP 200', response.status, 200)
  if (response.status !== 200) {
    console.log((await response.text()).slice(0, 300))
    app.exit(1)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = String(payload.choices?.[0]?.message?.content ?? '')
  const scores = parseJudgeResponse(raw)
  const overall = scoreJudge(scores as never)

  console.log(`süre: ${elapsed} ms · ayrıştırılan ölçüt: ${scores.length}`)
  for (const score of scores) {
    console.log(`  ${score.criterion.padEnd(13)} ${score.score} ${score.reason ? `— ${score.reason.slice(0, 60)}` : ''}`)
  }
  console.log(`ağırlıklı skor: ${overall}`)

  check('beş ölçüt döndü', scores.length, 5)
  check('skor 0-1 aralığında', overall > 0 && overall <= 1, true)
  // Orta kaliteli çıktı 1.0 almamalı; uydurma uç ve kanıt eksikliği var.
  check('orta kaliteli çıktı 1.0 almıyor', overall < 0.95, true)
  check('accuracy ölçütü var', scores.some((s) => s.criterion === 'accuracy'), true)

  console.log(`\nTOTAL=6 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
