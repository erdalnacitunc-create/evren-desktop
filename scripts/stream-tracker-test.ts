/// <reference types="node" />
import type { ChatEvent } from '../src/shared/types'
import {
  applyStreamEvent,
  belongsToRequest,
  emptyStreamState,
  hasPersistableContent,
  type StreamState
} from '../src/main/chatStreamTracker'

/**
 * Akış biriktirici testleri (saf mantık, Electron gerektirmez).
 * Çalıştırma: node scripts/run-unit.cjs scripts/stream-tracker-test.ts
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const rid = 'req-1'
const content = (text: string): ChatEvent => ({ requestId: rid, type: 'content', text })
const reasoning = (text: string): ChatEvent => ({ requestId: rid, type: 'reasoning', text })
const usage = (n: number): ChatEvent => ({
  requestId: rid,
  type: 'usage',
  usage: { prompt_tokens: n, completion_tokens: n }
})
const done = (finishReason: string | null): ChatEvent => ({ requestId: rid, type: 'done', finishReason })
const error = (message: string): ChatEvent => ({ requestId: rid, type: 'error', error: message })
const steering = (text: string): ChatEvent => ({ requestId: rid, type: 'steering', text })

/** Olayları sırayla uygular, son durum ve kayıt kararlarını döndürür. */
function run(events: ChatEvent[], start: StreamState = emptyStreamState()) {
  let state = start
  const persists: Array<string | null> = []
  for (const event of events) {
    const result = applyStreamEvent(state, event)
    state = result.state
    if (result.persist) persists.push(result.persist.finishReason)
  }
  return { state, persists }
}

// --- istek filtresi ---
check('aynı istek', belongsToRequest(content('x'), rid), true)
check('farklı istek', belongsToRequest({ requestId: 'other', type: 'content', text: 'x' }, rid), false)

// --- içerik birikimi ---
check('metin birikir', run([content('Mer'), content('haba')]).state.content, 'Merhaba')
check('düşünme birikir', run([reasoning('düşün'), reasoning('üyorum')]).state.reasoning, 'düşünüyorum')
check('içerik ve düşünme ayrı', run([content('a'), reasoning('b')]).state, {
  content: 'a',
  reasoning: 'b',
  persisted: false
})
check('boş metin durumu değiştirmez', run([content(''), reasoning('')]).state, emptyStreamState())

// --- immutable davranış ---
const before = emptyStreamState()
const after = applyStreamEvent(before, content('x')).state
check('girdi değişmez', before, { content: '', reasoning: '', persisted: false })
check('yeni nesne döner', after !== before, true)

// --- usage ---
check('usage saklanır', run([usage(5)]).state.usage, { prompt_tokens: 5, completion_tokens: 5 })
check('son usage kazanır', run([usage(5), usage(9)]).state.usage, {
  prompt_tokens: 9,
  completion_tokens: 9
})

// --- kayıt kararı ---
check('done içerikle kaydeder', run([content('yanıt'), done('stop')]).persists, ['stop'])
check('done sonrası persisted', run([content('yanıt'), done('stop')]).state.persisted, true)
check('error null ile kaydeder', run([content('kısmi'), error('ağ')]).persists, [null])
check('içeriksiz done kaydetmez', run([done('stop')]).persists, [])
check('içeriksiz error kaydetmez', run([error('ağ')]).persists, [])
check('sadece düşünme kaydedilir', run([reasoning('plan'), done('stop')]).persists, ['stop'])
check('boşluk içerik kaydetmez', run([content('   \n '), done('stop')]).persists, [])

// --- çift kayıt koruması ---
check('ikinci done kaydetmez', run([content('x'), done('stop'), done('stop')]).persists, ['stop'])
check('done sonrası error kaydetmez', run([content('x'), done('stop'), error('sonra')]).persists, ['stop'])
check('error sonrası done kaydetmez', run([content('x'), error('a'), done('stop')]).persists, [null])

// --- ilgisiz olaylar ---
check('steering kaydı etkilemez', run([content('x'), steering('ara mesaj'), done('stop')]).persists, ['stop'])
check('steering içeriğe eklenmez', run([content('x'), steering('ara')]).state.content, 'x')
check(
  'tool olayları yok sayılır',
  run([
    content('x'),
    { requestId: rid, type: 'tool-call', call: { id: 't1', name: 'read_file', arguments: '{}' } },
    done('stop')
  ]).state.content,
  'x'
)

// --- hasPersistableContent ---
check('boş durum içeriksiz', hasPersistableContent(emptyStreamState()), false)
check('düşünme yeterli', hasPersistableContent({ content: '', reasoning: 'x', persisted: false }), true)
check('boşluk yeterli değil', hasPersistableContent({ content: '  ', reasoning: ' ', persisted: false }), false)

// --- büyük akış ---
const many = Array.from({ length: 500 }, (_, index) => content(`${index},`))
const manyResult = run(many)
check('500 parça sayısı', manyResult.state.content.split(',').filter(Boolean).length, 500)
check('son parça korunur', manyResult.state.content.endsWith('499,'), true)

console.log(`TOTAL=27 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
