/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { profileFor, type HardwareInfo } from '../src/main/agent/hardwareProfile'
import { isTrimmableTool, trimStaleToolOutputs, trimToolOutput } from '../src/main/agent/toolOutput'
import {
  isParallelSafeTool,
  runWithConcurrency,
  shouldRunInParallel
} from '../src/main/agent/toolRunner'

/**
 * Performans optimizasyonu testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/performance-plan-test.ts
 *
 * ## Neden (araştırma → karar)
 *
 * Anthropic'in çoklu ajan yazısı: *"the subagents use 3+ tools in parallel …
 * cut research time by up to 90%"*. OpenAI Agents SDK: bağımsız işler
 * `asyncio.gather` ile paralel, ve `ToolOutputTrimmer` eski büyük araç
 * çıktılarını kırpar.
 *
 * Bizde ikisi de yoktu: araçlar sırayla koşuyordu ve tek bir `webfetch`
 * 93 984 karakteriyle bağlamda kalıyordu. Ama sınırsız paralellik düşük
 * RAM'li makinelerde ters teper — bu yüzden profil donanıma bağlı.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const hw = (cores: number, totalRamGb: number, freeRamGb = 4): HardwareInfo => ({
  cores,
  totalRamGb,
  freeRamGb
})

app.whenReady().then(async () => {
  // ============ 1) Donanım profilleri ============
  {
    const low = profileFor(hw(2, 4))
    check('2 çekirdek/4 GB → low', low.tier, 'low')
    check('low: seri araç', low.toolParallelism, 1)
    check('low: tek alt ajan', low.subagentConcurrency, 1)
    check('low: küçük çıktı bütçesi', low.maxToolOutputChars, 6_000)

    const mid = profileFor(hw(4, 8))
    check('4 çekirdek/8 GB → mid', mid.tier, 'mid')
    check('mid: 2 paralel araç', mid.toolParallelism, 2)
    check('mid: 2 alt ajan', mid.subagentConcurrency, 2)

    const high = profileFor(hw(8, 16))
    check('8 çekirdek/16 GB → high', high.tier, 'high')
    check('high: 3 paralel araç', high.toolParallelism, 3)
    check('high: alt ajan yine 2 (ramp-rate)', high.subagentConcurrency, 2)

    // Zayıf halka belirler.
    check('çok çekirdek + az RAM → mid', profileFor(hw(12, 8)).tier, 'mid')
    check('az çekirdek + çok RAM → low', profileFor(hw(2, 32)).tier, 'low')
    check('tek çekirdek', profileFor(hw(1, 2)).toolParallelism, 1)

    // Boş bellek daralırsa high profili paralelliği kısar.
    check('high + 1 GB boş → 2 paralel', profileFor(hw(8, 16, 1)).toolParallelism, 2)
    check('high + bol boş → 3 paralel', profileFor(hw(8, 16, 10)).toolParallelism, 3)
  }

  // ============ 2) Hangi araçlar paralel güvenli ============
  {
    check('read_file güvenli', isParallelSafeTool('read_file'), true)
    check('webfetch güvenli', isParallelSafeTool('webfetch'), true)
    check('grep güvenli', isParallelSafeTool('grep'), true)
    check('write_file güvenli değil', isParallelSafeTool('write_file'), false)
    check('run_command güvenli değil', isParallelSafeTool('run_command'), false)
    check('execute güvenli değil', isParallelSafeTool('execute'), false)
    check('spawn_agent güvenli değil', isParallelSafeTool('spawn_agent'), false)
    check('task_wait güvenli değil', isParallelSafeTool('task_wait'), false)
  }

  // ============ 3) Paralel kararı ============
  {
    const calls = (...names: string[]): Array<{ call: { name: string } }> =>
      names.map((name) => ({ call: { name } }))

    check('tek çağrı paralel değil', shouldRunInParallel(calls('read_file'), 4), false)
    check('iki okuma paralel', shouldRunInParallel(calls('read_file', 'grep'), 2), true)
    check('üç okuma paralel', shouldRunInParallel(calls('read_file', 'grep', 'glob'), 3), true)
    check(
      'yazma varsa seri',
      shouldRunInParallel(calls('read_file', 'write_file'), 4),
      false
    )
    check(
      'execute varsa seri',
      shouldRunInParallel(calls('webfetch', 'execute'), 4),
      false
    )
    check('paralellik 1 ise seri', shouldRunInParallel(calls('read_file', 'grep'), 1), false)
    check('boş liste', shouldRunInParallel([], 4), false)
  }

  // ============ 4) Sınırlı eşzamanlılık ============
  {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    let active = 0
    let peak = 0
    const order: number[] = []
    const results = await runWithConcurrency(items, 3, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(item)
      active -= 1
      return item * 10
    })
    check('sonuç girdi sırasında', results, [10, 20, 30, 40, 50, 60, 70, 80])
    check('eşzamanlılık sınırı aşılmadı', peak <= 3, true)
    check('en az 2 paralel çalıştı', peak >= 2, true)
    check('hepsi tamamlandı', order.length, 8)

    // limit > iş sayısı
    const single = await runWithConcurrency([1, 2], 10, async (item) => item)
    check('limit büyükse hepsi', single, [1, 2])

    // hata fırlatırsa Promise.reject olur
    let rejected = false
    try {
      await runWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('patlama')
        return item
      })
    } catch {
      rejected = true
    }
    check('hata yukarı taşınır', rejected, true)
  }

  // ============ 5) Araç çıktısı kırpma ============
  {
    const small = 'kısa çıktı'
    check('küçük çıktı dokunulmaz', trimToolOutput(small, { maxChars: 1000 }), small)

    const big = 'A'.repeat(50_000)
    const trimmed = trimToolOutput(big, { maxChars: 5_000, label: 'webfetch' })
    check('büyük çıktı sınırın altında kalır', trimmed.length <= 5_200, true)
    check('kırpma notu var', trimmed.includes('karakter kırpıldı'), true)
    check('araç adı notta', trimmed.includes('webfetch'), true)
    check('baş korunur', trimmed.startsWith('AAAA'), true)
    check('son korunur', trimmed.endsWith('AAAA'), true)
    check('boyut bildirilir', trimmed.includes('50.000'), true)

    // Türkçe/çok baytlı içerik bozulmaz.
    const turkish = 'çğıöşü '.repeat(5_000)
    const t = trimToolOutput(turkish, { maxChars: 2_000 })
    check('Türkçe korunur', /çğıöşü/.test(t), true)

    // headRatio uç değerleri güvenli.
    const h = trimToolOutput(big, { maxChars: 2_000, headRatio: 0.99 })
    check('headRatio 0.99 güvenli', h.length <= 2_200, true)
    const h2 = trimToolOutput(big, { maxChars: 2_000, headRatio: 0.01 })
    check('headRatio 0.01 güvenli', h2.length <= 2_200, true)
  }

  // ============ 6) Kırpılabilir araç listesi ============
  {
    check('webfetch kırpılır', isTrimmableTool('webfetch'), true)
    check('run_command kırpılır', isTrimmableTool('run_command'), true)
    check('read_file kırpılır', isTrimmableTool('read_file'), true)
    check('task_wait kırpılmaz (rapor)', isTrimmableTool('task_wait'), false)
    check('spawn_agent kırpılmaz', isTrimmableTool('spawn_agent'), false)
    check('todo_write kırpılmaz', isTrimmableTool('todo_write'), false)
  }

  // ============ 7) Eski tur kırpma ============
  {
    const big = 'X'.repeat(20_000)
    const messages = [
      { role: 'user', content: 'ilk istek' },
      { role: 'assistant', content: 'tamam' },
      { role: 'tool', tool_call_id: 'c1', content: big },
      { role: 'user', content: 'ikinci istek' },
      { role: 'tool', tool_call_id: 'c2', content: big },
      { role: 'user', content: 'üçüncü istek' },
      { role: 'tool', tool_call_id: 'c3', content: big }
    ]
    const names = new Map([
      ['c1', 'webfetch'],
      ['c2', 'webfetch'],
      ['c3', 'webfetch']
    ])
    const result = trimStaleToolOutputs(messages, {
      recentTurns: 2,
      maxChars: 5_000,
      previewChars: 300,
      toolNameOf: (m) => names.get(String(m.tool_call_id)),
      trimmableTools: (name) => (name ? isTrimmableTool(name) : false)
    })
    check('ilk eski çıktı kırpıldı', result.trimmedCount, 1)
    check(
      'son iki tur korunur',
      String(result.messages[6]?.content).length,
      20_000
    )
    check(
      'kırpılan ileti kısa',
      String(result.messages[2]?.content).length < 600,
      true
    )
    check('kullanıcı iletileri değişmez', result.messages[0]?.content, 'ilk istek')

    // task_wait raporu asla kırpılmaz.
    const withTask = [
      { role: 'user', content: 'ilk' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'user', content: 'ikinci' },
      { role: 'user', content: 'üçüncü' }
    ]
    const taskResult = trimStaleToolOutputs(withTask, {
      recentTurns: 1,
      maxChars: 5_000,
      previewChars: 300,
      toolNameOf: () => 'task_wait',
      trimmableTools: (name) => (name ? isTrimmableTool(name) : false)
    })
    check('task_wait raporu kırpılmaz', taskResult.trimmedCount, 0)
  }

  console.log(`TOTAL=52 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
