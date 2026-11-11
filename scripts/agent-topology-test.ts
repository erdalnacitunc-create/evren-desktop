/// <reference types="node" />
import {
  AUTO_SKILL_DRAFTS_PER_SESSION,
  AUTO_SKILL_DRAFTS_PER_WEEK,
  AUTO_SKILL_REPEAT_THRESHOLD,
  DUPLICATE_TASK_SIMILARITY,
  MAX_CONCURRENT_SUBAGENTS,
  MAX_MULTIVERSE_MEMBERS,
  MAX_SUBAGENTS_PER_REQUEST,
  MAX_SUBAGENT_DEPTH,
  MAX_TOTAL_MODEL_CALLS,
  SKILLS_INJECTED_PER_AGENT,
  SKILL_BODY_MAX_TOKENS,
  SKILL_CATALOG_MAX_TOKENS,
  SUBAGENT_MAX_STEPS,
  SUBAGENT_MAX_TOOL_CALLS,
  buildStages,
  isDuplicateTask,
  planTopology,
  taskSimilarity,
  validatePlan,
  wordCount,
  type TopologyInput
} from '../src/shared/agentTopology'

/**
 * Hibrit topoloji triage testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-topology-test.ts
 *
 * Amaç: hangi sorgunun hangi moda düştüğünü ve hiçbir planın sert tavanları
 * aşmadığını doğrulamak. Gerçek koşu verisi gelene kadar eşikler tahmindir;
 * bu testler yalnızca tutarlılığı garanti eder.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const base: TopologyInput = {
  query: '',
  hasWorkspace: true,
  multiverseRequested: false
}

// ============ 1) Basit işler → direct ============
{
  check('kısa soru', planTopology({ ...base, query: 'README dosyasını aç' }).mode, 'direct')
  check('tek eylem', planTopology({ ...base, query: 'bu satırı sil' }).mode, 'direct')
  check(
    'tek eylem + karar sinyali yok',
    planTopology({ ...base, query: 'package.json sürümünü düzelt' }).mode,
    'direct'
  )
  check(
    'direct tek çağrı',
    planTopology({ ...base, query: 'dosyayı sil' }).maxModelCalls,
    1
  )
}

// ============ 2) Genişlik → recon ============
{
  const p = planTopology({
    ...base,
    query: 'projede tüm USB ile ilgili modülleri bul ve hangi dosyalarda olduğunu listele'
  })
  check('envanter sorgusu recon', p.mode, 'recon')
  check('recon alt ajan 2-4 arası', p.reconSubagents >= 2 && p.reconSubagents <= 4, true)
  check('recon üye model yok', p.memberModels, 0)
  check('recon yazma lidere ait', p.writeAuthority, 'lead-only')
}

// ============ 3) Karar → multiverse ============
{
  const p = planTopology({
    ...base,
    query: 'Bu projede SQLite mı dosya tabanlı depo mu daha iyi? Hangisini tercih etmeliyim?'
  })
  check('tercih sorgusu multiverse', p.mode, 'multiverse')
  check('üye model 2-3', p.memberModels >= 2 && p.memberModels <= 3, true)
  check('multiverse alt ajan yok', p.reconSubagents, 0)
}

// ============ 4) Karmaşık + riskli → hybrid ============
{
  const p = planTopology({
    ...base,
    query:
      'Tüm oturum katmanını incele ve listele; ardından dosya tabanlı depodan SQLite mimarisine geçiş için hangi yaklaşımı tercih etmeliyiz, riskleri neler?'
  })
  check('hibrit mod', p.mode, 'hybrid')
  check('hibritte alt ajan var', p.reconSubagents >= 2, true)
  check('hibritte üye model var', p.memberModels >= 2, true)
  check('hibrit yazma lidere ait', p.writeAuthority, 'lead-only')
  check('hibrit tavan içinde', p.maxModelCalls <= MAX_TOTAL_MODEL_CALLS, true)
}

// ============ 5) Kullanıcı seçimi her zaman kazanır ============
{
  const forced = planTopology({ ...base, query: 'README aç', multiverseRequested: true })
  check('basit soruda bile Çoklu Evren', forced.mode === 'multiverse' || forced.mode === 'hybrid', true)
  check('kullanıcı seçimi sinyali', forced.signals.includes('kullanıcı-seçimi'), true)
  check('üye model en az 2', forced.memberModels >= 2, true)
}

// ============ 6) Bütçe ============
{
  const broke = planTopology({ ...base, query: 'mimari seçimi yap', remainingCallBudget: 1 })
  check('bütçe yoksa direct', broke.mode, 'direct')
  check('bütçe sinyali', broke.signals.includes('bütçe-yetersiz'), true)

  const tight = planTopology({
    ...base,
    query: 'tüm modülleri listele ve mimari yaklaşımı karşılaştır',
    remainingCallBudget: 4
  })
  check('dar bütçede tavan aşılmaz', tight.maxModelCalls <= 4, true)
}

// ============ 7) validatePlan: hiçbir plan tavan aşmaz ============
{
  const queries = [
    'dosyayı sil',
    'tüm dosyaları listele',
    'hangi mimari daha iyi?',
    'tüm katmanları incele ve geçiş stratejisini karşılaştır, riskleri neler?',
    'bir şey yap'
  ]
  let allValid = true
  const bad: string[] = []
  for (const query of queries) {
    for (const budget of [1, 2, 3, 5, 8, 12, 20]) {
      const plan = planTopology({ ...base, query, remainingCallBudget: budget })
      const problems = validatePlan(plan, Math.max(budget, 1))
      if (problems.length > 0) {
        allValid = false
        bad.push(`${query} (bütçe ${budget}): ${problems.join(', ')}`)
      }
    }
  }
  check('tüm planlar geçerli', allValid, true)
  if (bad.length > 0) for (const line of bad.slice(0, 5)) console.log('   ', line)
}

// ============ 8) Aşama sırası ============
{
  const hybrid = planTopology({
    ...base,
    query: 'tüm servisleri listele ve hangi mimariyi tercih etmeliyiz, riskleri neler?'
  })
  const stages = buildStages(hybrid)
  check('ilk aşama recon', stages[0]?.stage, 'recon')
  check('recon paralel', stages[0]?.parallel, true)
  check('recon salt-okunur', stages[0]?.readOnly, true)
  check('son aşama action', stages[stages.length - 1]?.stage, 'action')
  check('action yazabilir', stages[stages.length - 1]?.readOnly, false)
  check('action paralel değil', stages[stages.length - 1]?.parallel, false)

  const direct = buildStages(planTopology({ ...base, query: 'dosyayı sil' }))
  check('direct tek aşama', direct.length, 1)
  check('direct action', direct[0]?.stage, 'action')
}

// ============ 9) Sert sınırlar tutarlı ============
{
  check('eşzamanlı ≤ istek başına', MAX_CONCURRENT_SUBAGENTS <= MAX_SUBAGENTS_PER_REQUEST, true)
  check('derinlik 1', MAX_SUBAGENT_DEPTH, 1)
  check('üye model tavanı', MAX_MULTIVERSE_MEMBERS, 3)
  check('toplam çağrı tavanı', MAX_TOTAL_MODEL_CALLS, 12)
  check('alt ajan adım', SUBAGENT_MAX_STEPS, 10)
  check('alt ajan araç', SUBAGENT_MAX_TOOL_CALLS, 20)
  check('skill katalog bütçesi', SKILL_CATALOG_MAX_TOKENS, 6000)
  check('ajan başına skill', SKILLS_INJECTED_PER_AGENT, 3)
  check('skill gövde tavanı', SKILL_BODY_MAX_TOKENS, 4000)
  check('otomatik taslak/oturum', AUTO_SKILL_DRAFTS_PER_SESSION, 1)
  check('otomatik taslak/hafta', AUTO_SKILL_DRAFTS_PER_WEEK, 3)
  check('tekrar eşiği', AUTO_SKILL_REPEAT_THRESHOLD, 3)
}

// ============ 10) Görev benzerliği ============
{
  check('aynı metin', Math.round(taskSimilarity('usb tara', 'usb tara') * 100) / 100, 1)
  check('alakasız', taskSimilarity('usb tara', 'git commit at') < 0.2, true)
  check(
    'benzer görev',
    taskSimilarity('usb cihazlarını listele', 'usb cihazlarını tara') > 0.4,
    true
  )
  check(
    'tekrar tespit edilir',
    isDuplicateTask('usb cihazlarını listele', ['usb cihazlarını listele ve incele']),
    true
  )
  check(
    'farklı iş tekrar sayılmaz',
    isDuplicateTask('usb cihazlarını listele', ['git durumunu göster']),
    false
  )
  check('eşik sabiti', DUPLICATE_TASK_SIMILARITY, 0.7)
  check('boş metin', taskSimilarity('', 'abc'), 0)
}

// ============ 11) Kelime sayısı ============
{
  check('boş', wordCount(''), 0)
  check('üç kelime', wordCount('bir iki üç'), 3)
  check('fazla boşluk', wordCount('  bir   iki  '), 2)
}

// ============ 12) Deterministik ============
{
  const input: TopologyInput = {
    ...base,
    query: 'tüm modülleri listele ve hangi mimariyi tercih etmeliyiz?'
  }
  const a = planTopology(input)
  const b = planTopology(input)
  check('aynı girdi aynı plan', JSON.stringify(a), JSON.stringify(b))
}

console.log(`TOTAL=54 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
