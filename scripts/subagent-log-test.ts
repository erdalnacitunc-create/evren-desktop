/// <reference types="node" />
import { app } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import {
  formatSubagentLogs,
  logSubagent,
  readSubagentLogs,
  resetSubagentLogRing,
  summarizeSubagentLogs
} from '../src/main/agent/subagentLog'

/**
 * Alt ajan izleme günlüğü testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/subagent-log-test.ts
 *
 * ## Neden
 *
 * 0.4.13 canlı koşusunda bir explore ajanı 186 sn çalıştı, `task_wait` 120 sn'de
 * düştü ve sonuç kayboldu. `main.log`'da yalnızca tek satır vardı; hangi araçta,
 * kaç adımda, ne kadar sürede takıldığı görünmüyordu. Bu test yapılandırılmış
 * günlüğün sorgulanabilir, döndürülebilir ve sır sızdırmaz olduğunu sabitler.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
const logDir = join(dataDir, 'subagent-logs')
rmSync(logDir, { recursive: true, force: true })
mkdirSync(logDir, { recursive: true })
process.env['EVREN_SUBAGENT_LOG_DIR'] = logDir
process.env['EVREN_SUBAGENT_LOG_MAX_BYTES'] = String(64 * 1024)

app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

app.whenReady().then(() => {
  resetSubagentLogRing()

  // ============ 1) Yazma ve sorgulama ============
  logSubagent({
    phase: 'spawn',
    taskId: 'sub-A',
    requestId: 'req-1',
    agentType: 'explore',
    msg: 'spawn istendi',
    data: { files: [] }
  })
  logSubagent({
    phase: 'tool',
    taskId: 'sub-A',
    requestId: 'req-1',
    agentType: 'explore',
    msg: 'read_file ok',
    data: { durationMs: 41, ok: true }
  })
  logSubagent({
    phase: 'tool',
    level: 'warn',
    taskId: 'sub-A',
    requestId: 'req-1',
    agentType: 'explore',
    msg: 'grep başarısız',
    data: { durationMs: 900, ok: false, error: 'zaman aşımı' }
  })
  logSubagent({
    phase: 'finish',
    level: 'error',
    taskId: 'sub-A',
    requestId: 'req-1',
    agentType: 'explore',
    msg: 'alt ajan hata ile sonlandı'
  })
  logSubagent({
    phase: 'spawn',
    taskId: 'sub-B',
    requestId: 'req-1',
    agentType: 'general',
    msg: 'spawn istendi'
  })

  {
    const all = readSubagentLogs({ requestId: 'req-1', limit: 100 })
    check('beş olay yazıldı', all.length, 5)
    check('A görevi dört olay', readSubagentLogs({ taskId: 'sub-A' }).length, 4)
    check('B görevi tek olay', readSubagentLogs({ taskId: 'sub-B' }).length, 1)
    check(
      'warn filtresi',
      readSubagentLogs({ taskId: 'sub-A', level: 'warn' }).length,
      2
    )
    check(
      'error filtresi',
      readSubagentLogs({ taskId: 'sub-A', level: 'error' }).length,
      1
    )
    check('bilinmeyen görev boş', readSubagentLogs({ taskId: 'sub-yok' }).length, 0)
  }

  // ============ 2) Özet ============
  {
    const summary = summarizeSubagentLogs({ requestId: 'req-1' })
    check('özet toplam', summary.total, 5)
    check('özet hata sayısı', summary.errors, 1)
    check('özet uyarı sayısı', summary.warnings, 1)
    check('özet aşama sayacı', summary.phases['spawn'], 2)
    check('özet hata metni', summary.errorMessages.length, 1)
    check('özet zaman aralığı var', typeof summary.firstAt === 'number', true)
  }

  // ============ 3) Sır maskeleme ============
  {
    logSubagent({
      phase: 'error',
      level: 'error',
      taskId: 'sub-C',
      requestId: 'req-2',
      msg: 'istek başarısız: sk-abcdefghijklmnopqrstuvwxyz123456'
    })
    const events = readSubagentLogs({ taskId: 'sub-C' })
    check('sk- anahtarı maskelendi', events[0]?.msg.includes('abcdefghijklmnop'), false)
    check('maske izi var', events[0]?.msg.includes('sk-***'), true)
  }

  // ============ 4) Uzun veri kırpılır ============
  {
    logSubagent({
      phase: 'tool',
      taskId: 'sub-D',
      requestId: 'req-3',
      msg: 'uzun çıktı',
      data: { output: 'x'.repeat(5000) }
    })
    const events = readSubagentLogs({ taskId: 'sub-D' })
    const output = String(events[0]?.data?.['output'] ?? '')
    check('uzun çıktı kırpıldı', output.length < 2100, true)
    check('kırpma işareti var', output.endsWith('…'), true)
  }

  // ============ 5) Biçimlendirme ============
  {
    const text = formatSubagentLogs(readSubagentLogs({ taskId: 'sub-A' }))
    check('biçim aşama içeriyor', text.includes('spawn'), true)
    check('biçim hata seviyesi', text.includes('HATA'), true)
    check('boş günlük mesajı', formatSubagentLogs([]), 'Kayıt yok.')
  }

  // ============ 6) Döndürme (rotation) ============
  {
    // 64 KB sınır; tek olay ~64 KB'ı aşacak şekilde yaz.
    for (let index = 0; index < 40; index += 1) {
      logSubagent({
        phase: 'tool',
        taskId: 'sub-rotate',
        requestId: 'req-rot',
        msg: `olay ${index}`,
        data: { blob: 'y'.repeat(1900) }
      })
    }
    const backup = join(logDir, 'subagent-events.1.jsonl')
    check('yedek dosya oluştu', existsSync(backup), true)
    check(
      'döndürme sonrası olaylar okunabiliyor',
      readSubagentLogs({ taskId: 'sub-rotate', limit: 2000 }).length >= 1,
      true
    )
  }

  console.log(`TOTAL=21 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
