/// <reference types="node" />
import { app } from 'electron'
import { createServer } from 'http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runSubagent } from '../src/main/agent/subagent'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * Doğrulama kapısı uçtan uca testi (0.4.24).
 * Çalıştırma: node scripts/run-unit.cjs scripts/verify-gate-e2e-test.ts
 *
 * ## Senaryo
 *
 * `general` alt ajanı dosya yazar, "bitti" der. Projenin testi başarısızdır.
 *
 * Beklenen:
 * 1. Kapı **kendisi** testi çalıştırır (model "geçti" dese de).
 * 2. Başarısızlık modele geri gönderilir; istem testi gevşetmeyi yasaklar.
 * 3. Model düzeltince ikinci kapı geçer ve sonuç `verified: true` olur.
 *
 * İkinci senaryo: projede kontrol tanımlı değilse sonuç "geçti" değil
 * **"doğrulanmadı"** olmalı — ölçemeyen araç başarı göstermez.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
let total = 0
function check(label: string, actual: unknown, expected: unknown): void {
  total += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}
function contains(label: string, text: string, needle: string, expected = true): void {
  total += 1
  const ok = text.includes(needle) === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

interface Capture {
  rounds: number
  sawGateRetry: boolean
  sawForbiddenGaming: boolean
  lastUserText: string
}

interface ScriptStep {
  tool?: { name: string; args: Record<string, unknown> }
  content?: string
}

function startServer(script: ScriptStep[]) {
  const capture: Capture = {
    rounds: 0,
    sawGateRetry: false,
    sawForbiddenGaming: false,
    lastUserText: ''
  }

  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const messages = (body['messages'] ?? []) as Array<{ role?: string; content?: unknown }>
      const allText = messages
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n')

      if (allText.includes('DOĞRULAMA BAŞARISIZ')) capture.sawGateRetry = true
      if (allText.includes('gevşetme') && allText.includes('silme')) {
        capture.sawForbiddenGaming = true
      }
      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      if (lastUser && typeof lastUser.content === 'string') capture.lastUserText = lastUser.content

      const step = script[Math.min(capture.rounds, script.length - 1)] ?? { content: 'Bitti.' }
      capture.rounds += 1

      response.writeHead(200, { 'content-type': 'text/event-stream' })

      if (step.tool) {
        response.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-${capture.rounds}`,
                      function: {
                        name: step.tool.name,
                        arguments: JSON.stringify(step.tool.args)
                      }
                    }
                  ]
                }
              }
            ]
          })
        )
        response.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        response.end('data: [DONE]\n\n')
        return
      }

      response.write(sse({ choices: [{ delta: { content: step.content ?? 'Bitti.' } }] }))
      response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      response.end('data: [DONE]\n\n')
    })
  })

  return new Promise<{ server: ReturnType<typeof createServer>; port: number; capture: Capture }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve({
          server,
          port: typeof address === 'object' && address ? address.port : 0,
          capture
        })
      })
    }
  )
}

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'verify-gate-e2e')
  rmSync(base, { recursive: true, force: true })

  // ============ 1) Başarısız test → geri gönderim → düzeltme ============
  {
    mkdirSync(join(base, 'fix'), { recursive: true })
    writeFileSync(join(base, 'fix', 'check.js'), 'process.exit(3)\n', 'utf8')
    writeFileSync(
      join(base, 'fix', 'package.json'),
      JSON.stringify({ name: 'gate-e2e', scripts: { test: 'node check.js' } }, null, 2),
      'utf8'
    )

    const { server, port, capture } = await startServer([
      { tool: { name: 'write_file', args: { path: 'src/a.txt', content: 'merhaba\n' } } },
      { content: 'Değişiklik yapıldı.' },
      { tool: { name: 'write_file', args: { path: 'check.js', content: 'process.exit(0)\n' } } },
      { content: 'Test düzeltildi, kontroller geçiyor.' }
    ])

    const result = await runWithWorkspace(join(base, 'fix'), () =>
      runSubagent({
        parentRequestId: 'req-gate-e2e',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'general',
        prompt: 'src/a.txt oluştur',
        workspaceRoot: join(base, 'fix'),
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )
    server.close()

    check('koşu başarılı', result.ok, true)
    check('kapı modeli düzelttikten sonra geçti', result.verified, true)
    check('kapı sonucu rapora eklendi', result.verify?.ran, true)
    contains('raporda ✓', result.content, '✓ geçti')
    check('modele geri gönderim yapıldı', capture.sawGateRetry, true)
    check('geri gönderimde oyunlaştırma yasağı var', capture.sawForbiddenGaming, true)
    check('model düzeltme turunu gördü (4+ tur)', capture.rounds >= 4, true)
    check('düzeltme gerçekten yazıldı', readFileSync(join(base, 'fix', 'check.js'), 'utf8').includes('exit(0)'), true)
  }

  // ============ 2) Kontrol tanımsız → "doğrulanmadı" ============
  {
    mkdirSync(join(base, 'nochecks'), { recursive: true })
    const { server, port } = await startServer([
      { tool: { name: 'write_file', args: { path: 'notes.md', content: 'x\n' } } },
      { content: 'Not dosyası yazıldı.' }
    ])

    const result = await runWithWorkspace(join(base, 'nochecks'), () =>
      runSubagent({
        parentRequestId: 'req-gate-nochecks',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'general',
        prompt: 'notes.md oluştur',
        workspaceRoot: join(base, 'nochecks'),
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )
    server.close()

    check('kontrolsüz koşu ok', result.ok, true)
    check('kontrolsüz koşu doğrulanmadı', result.verified, false)
    check('kontrolsüz koşuda kapı çalışmadı', result.verify?.ran, false)
    contains('raporda dürüst ifade', result.content, 'doğrulanmadı')
    contains('raporda "geçti" iddiası yok', result.content, '✓ geçti', false)
  }

  // ============ 3) review ajanı: diff hazır bağlamda ============
  {
    const { server, port, capture } = await startServer([{ content: 'İnceleme tamam: sorun yok.' }])
    const result = await runWithWorkspace(join(base, 'fix'), () =>
      runSubagent({
        parentRequestId: 'req-review-brief',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'review',
        prompt: 'Son değişiklikleri hata odaklı incele',
        workspaceRoot: join(base, 'fix'),
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )
    server.close()

    contains('review istemi değişiklik listesi taşır', capture.lastUserText, 'Değişen dosyalar')
    contains('review istemi yazılan dosyayı taşır', capture.lastUserText, 'src/a.txt')
    contains('review istemi görevi korur', capture.lastUserText, 'hata odaklı incele')
    check('review incelemesi bitti', result.ok, true)
  }

  // ============ 4) Ajan yazdıktan sonra run_checks çalıştırdıysa kapı tekrar koşmaz ============
  {
    const selfCheck = join(base, 'selfcheck')
    mkdirSync(selfCheck, { recursive: true })
    // Her koşuda runs.txt'ye bir satır ekle: kapı ikinci kez koşarsa 2 satır olur.
    writeFileSync(
      join(selfCheck, 'check.js'),
      "require('fs').appendFileSync('runs.txt', 'x\\n'); process.exit(0)\n",
      'utf8'
    )
    writeFileSync(
      join(selfCheck, 'package.json'),
      JSON.stringify({ name: 'selfcheck', scripts: { test: 'node check.js' } }, null, 2),
      'utf8'
    )

    const { server, port } = await startServer([
      { tool: { name: 'write_file', args: { path: 'a.txt', content: 'x\n' } } },
      { tool: { name: 'run_checks', args: { names: ['test'] } } },
      { content: 'Yazıldı ve kontroller geçti.' }
    ])

    const result = await runWithWorkspace(selfCheck, () =>
      runSubagent({
        parentRequestId: 'req-selfcheck',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'general',
        prompt: 'a.txt oluştur ve kontrolleri çalıştır',
        workspaceRoot: selfCheck,
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )
    server.close()

    check('kendi kontrolü kanıt sayıldı', result.verified, true)
    contains('kendi kontrolü raporda belirtilir', result.content, 'kendi `run_checks`')
    const runs = readFileSync(join(selfCheck, 'runs.txt'), 'utf8').trim().split('\n').length
    check('kontrol yalnızca bir kez koştu', runs, 1)
  }

  // ============ 5) Kendi run_checks'i başarısız → düzeltmeye geri gönderilir ============
  {
    const selfFail = join(base, 'selffail')
    mkdirSync(selfFail, { recursive: true })
    writeFileSync(join(selfFail, 'check.js'), 'process.exit(1)\n', 'utf8')
    writeFileSync(
      join(selfFail, 'package.json'),
      JSON.stringify({ name: 'selffail', scripts: { test: 'node check.js' } }, null, 2),
      'utf8'
    )

    const { server, port, capture } = await startServer([
      { tool: { name: 'write_file', args: { path: 'a.txt', content: 'x\n' } } },
      { tool: { name: 'run_checks', args: { names: ['test'] } } },
      { content: 'Yazdım; kontroller başarısız.' }
    ])

    const result = await runWithWorkspace(selfFail, () =>
      runSubagent({
        parentRequestId: 'req-selffail',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'general',
        prompt: 'a.txt oluştur ve kontrolleri çalıştır',
        workspaceRoot: selfFail,
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )
    server.close()

    check('kendi kontrolü başarısızsa doğrulanmadı', result.verified, false)
    check('kendi kontrolü için düzeltme turu açıldı', capture.sawGateRetry, true)
    contains('raporda kendi kontrolü BAŞARISIZ', result.content, 'BAŞARISIZ')
    contains('raporda geçti iddiası yok', result.content, '✓ geçti', false)
  }

  // ============ 6) run_command ile değişiklik de kapıyı tetikler ============
  {
    const cmd = join(base, 'cmdmutate')
    mkdirSync(cmd, { recursive: true })
    writeFileSync(join(cmd, 'check.js'), 'process.exit(2)\n', 'utf8')
    writeFileSync(
      join(cmd, 'package.json'),
      JSON.stringify({ name: 'cmdmutate', scripts: { test: 'node check.js' } }, null, 2),
      'utf8'
    )

    const { server, port } = await startServer([
      { tool: { name: 'run_command', args: { command: 'Set-Content -Path b.txt -Value x' } } },
      { content: 'Dosya komutla yazıldı.' }
    ])

    const result = await runWithWorkspace(cmd, () =>
      runSubagent({
        parentRequestId: 'req-cmdmutate',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test',
        model: 'gate-model',
        agentType: 'general',
        prompt: 'b.txt dosyasını komutla oluştur',
        workspaceRoot: cmd,
        mode: 'auto',
        profile: 'build',
        controller: new AbortController(),
        send: () => undefined
      })
    )
    server.close()

    // `run_command` doğrudan yazma aracı değil; mutasyon değişiklik
    // günlüğünden yakalanır. Yakalanmazsa kapı sessizce atlanır — bu, tam
    // olarak kapatmaya çalıştığımız kusurdur.
    check('komutla yapılan değişiklik kapıyı tetikledi', result.verify?.ran, true)
    check('komutla değişiklikte kapı sonucu dürüst', result.verified, false)
    contains('komutla değişiklikte başarısızlık bildirilir', result.content, 'BAŞARISIZ')
  }

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
