/// <reference types="node" />
import type { ChatEvent } from '../src/shared/types'
import {
  asSink,
  createRecordingSink,
  createRequestSink,
  createSafeSink,
  type AgentEventSink
} from '../src/main/agent/eventSink'

/**
 * Ajan olay çıkış noktası (sink) testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/event-sink-test.ts
 *
 * Süreç ayrımında ajan döngüsünün tek çıkışı bu arayüz olacak; burada
 * sözleşmesini kilitliyoruz.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const rid = 'req-1'
const content = (text: string, requestId = rid): ChatEvent => ({ requestId, type: 'content', text })
const done: ChatEvent = { requestId: rid, type: 'done', finishReason: 'stop' }

// --- asSink ---
{
  const received: ChatEvent[] = []
  const sink = asSink((event) => received.push(event))
  sink.emit(content('a'))
  sink.emit(done)
  check('asSink iletir', received.length, 2)
  check('asSink sırayı korur', received.map((event) => event.type), ['content', 'done'])
}

// --- recording sink ---
{
  const sink = createRecordingSink()
  sink.emit(content('a'))
  sink.emit(content('b'))
  sink.emit(done)
  check('kaydeder', sink.events.length, 3)
  check('tür sayar', sink.countOf('content'), 2)
  check('done sayar', sink.countOf('done'), 1)
  check('olmayan tür 0', sink.countOf('error'), 0)
  sink.clear()
  check('temizlenir', sink.events.length, 0)
}

// --- request sink: filtre ---
{
  const inner = createRecordingSink()
  const sink = createRequestSink(inner, rid)
  sink.emit(content('benim'))
  sink.emit(content('başkasının', 'req-2'))
  sink.emit(done)
  sink.emit({ requestId: 'req-2', type: 'done', finishReason: null })
  check('yalnızca kendi isteği geçer', inner.events.length, 2)
  check('hepsi doğru istek', inner.events.every((event) => event.requestId === rid), true)
  check('yabancı metin sızmaz', inner.events.some((event) => event.type === 'content' && event.text === 'başkasının'), false)
}

// --- request sink: boş istek kimliği ---
{
  const inner = createRecordingSink()
  const sink = createRequestSink(inner, '')
  sink.emit(content('x', ''))
  sink.emit(content('y', rid))
  check('boş kimlik kendi olayını geçirir', inner.events.length, 1)
}

// --- safe sink: hata yutulur ---
{
  const failing: AgentEventSink = {
    emit(): void {
      throw new Error('taşıyıcı çöktü')
    }
  }
  const safe = createSafeSink(failing)
  let threw = false
  try {
    safe.emit(content('a'))
    safe.emit(done)
  } catch {
    threw = true
  }
  check('hata dışarı sızmaz', threw, false)
}

// --- safe sink: normal akış ---
{
  const inner = createRecordingSink()
  const safe = createSafeSink(inner)
  safe.emit(content('a'))
  safe.emit(done)
  check('normal akış korunur', inner.events.length, 2)
}

// --- kompozisyon: request + safe + recording (loop.ts ile aynı sıra) ---
{
  const inner = createRecordingSink()
  const sink = createSafeSink(createRequestSink(inner, rid))
  sink.emit(content('ilk'))
  sink.emit(content('yabancı', 'req-9'))
  sink.emit({ requestId: rid, type: 'usage', usage: { prompt_tokens: 1 } })
  sink.emit(done)
  check('kompozisyon sırası', inner.events.map((event) => event.type), ['content', 'usage', 'done'])
  check('kompozisyon filtresi', inner.events.length, 3)
}

// --- hata sonrası akış devam eder ---
{
  let calls = 0
  const flaky: AgentEventSink = {
    emit(): void {
      calls += 1
      if (calls === 1) throw new Error('ilk çağrı bozuk')
    }
  }
  const safe = createSafeSink(flaky)
  safe.emit(content('a'))
  safe.emit(content('b'))
  safe.emit(done)
  check('sonraki olaylar iletilir', calls, 3)
}

// --- büyük hacim ---
{
  const inner = createRecordingSink()
  const sink = createSafeSink(createRequestSink(inner, rid))
  for (let index = 0; index < 500; index++) sink.emit(content(String(index)))
  check('500 olay kaybolmaz', inner.events.length, 500)
  check('sıra korunur', (inner.events[499] as { text: string }).text, '499')
}

console.log(`TOTAL=18 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
