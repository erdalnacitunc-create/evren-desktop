/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import {
  __setEventsPath,
  appendSessionEvent,
  nextSeq,
  projectSession,
  projectStoredSession,
  readEvents,
  resetSeqCache,
  seedSeq,
  type SessionEvent
} from '../src/main/sessionEvents'

/**
 * Kalıcı olay günlüğü ve projeksiyon testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/session-events-test.ts
 *
 * İddia (OpenCode `Event.durable` + `SessionProjector`):
 *  - her olay diske eklenir
 *  - projeksiyon saf fonksiyondur, aynı olaylar aynı mesajları üretir
 *  - bozuk satırlar tüm günlüğü düşürmez
 *  - oturum, yalnızca günlükten yeniden kurulabilir
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const event = (
  seq: number,
  type: SessionEvent['type'],
  data: Record<string, unknown>,
  at = 1000 + seq
): SessionEvent => ({ seq, sessionId: 's1', type, at, data })

app.whenReady().then(async () => {
  // ============ 1) Projeksiyon: tam akış ============
  {
    const events = [
      event(1, 'session.created', { modelId: 'm1' }),
      event(2, 'user.message', { content: 'usb tara' }),
      event(3, 'assistant.started', { messageId: 'a1' }),
      event(4, 'reasoning.delta', { messageId: 'a1', text: 'düşünüyorum' }),
      event(5, 'text.delta', { messageId: 'a1', text: 'USB ' }),
      event(6, 'tool.called', { messageId: 'a1', id: 'c1', name: 'usb_devices', arguments: '{}' }),
      event(7, 'tool.result', {
        messageId: 'a1',
        toolCallId: 'c1',
        name: 'usb_devices',
        ok: true,
        content: '13 cihaz'
      }),
      event(8, 'text.delta', { messageId: 'a1', text: 'tarandı.' }),
      event(9, 'step.ended', { messageId: 'a1', finishReason: 'stop' }),
      event(10, 'assistant.completed', { messageId: 'a1', finishReason: 'stop' })
    ]

    const projected = projectSession(events)
    check('iki mesaj', projected.messages.length, 2)
    check('kullanıcı mesajı', projected.messages[0]?.content, 'usb tara')
    check('asistan metni birleşti', projected.messages[1]?.content, 'USB tarandı.')
    check('düşünme birleşti', projected.messages[1]?.reasoning, 'düşünüyorum')
    check('araç çağrısı kaydedildi', projected.messages[1]?.toolCalls.length, 1)
    check('araç adı', projected.messages[1]?.toolCalls[0]?.name, 'usb_devices')
    check('araç sonucu', projected.messages[1]?.toolResults[0]?.content, '13 cihaz')
    check('bitiş nedeni', projected.messages[1]?.finishReason, 'stop')
    check('son sıra', projected.lastSeq, 10)
    check('bozuk olay yok', projected.skipped, 0)
    check('bilinmeyen tür yok', projected.unknownTypes, [])
  }

  // ============ 2) Retry ve continue projeksiyonu ============
  {
    const events = [
      event(1, 'user.message', { content: 'soru' }),
      event(2, 'assistant.started', { messageId: 'a1' }),
      event(3, 'text.delta', { messageId: 'a1', text: 'kısmi ' }),
      event(4, 'retry.scheduled', {
        messageId: 'a1',
        attempt: 2,
        at: 5000,
        error: { type: 'RateLimit', message: 'sınır', status: 429 }
      }),
      event(5, 'retry.cleared', { messageId: 'a1' }),
      event(6, 'continue.started', { messageId: 'a1', reason: 'interrupted', attempt: 1 }),
      event(7, 'text.delta', { messageId: 'a1', text: 'devam' })
    ]
    const projected = projectSession(events)
    const assistant = projected.messages[1]
    check('retry temizlendi', assistant?.retry, undefined)
    check('continuations sayıldı', assistant?.continuations, 1)
    check('metin korundu + devam', assistant?.content, 'kısmi devam')

    // retry açık bırakılırsa görünür
    const open = projectSession(events.slice(0, 4))
    check('açık retry görünür', open.messages[1]?.retry?.attempt, 2)
    check('retry hatası', open.messages[1]?.retry?.error.status, 429)
  }

  // ============ 3) Bozuk olaylar atlanır ============
  {
    const events = [
      event(1, 'user.message', { content: 'a' }),
      { seq: 2, sessionId: 's1', type: 'text.delta', at: 1, data: null } as unknown as SessionEvent,
      event(3, 'text.delta', { messageId: 'yok', text: 'x' }),
      { seq: 4, sessionId: 's1', type: 'bilinmeyen.olay', at: 1, data: {} } as unknown as SessionEvent,
      event(5, 'user.message', { content: 'b' })
    ]
    const projected = projectSession(events)
    check('sağlam mesajlar kaldı', projected.messages.length, 2)
    check('bozuk olaylar sayıldı', projected.skipped, 2)
    check('bilinmeyen tür raporlandı', projected.unknownTypes, ['bilinmeyen.olay'])
  }

  // ============ 4) Projeksiyon deterministik ============
  {
    const events = [
      event(1, 'user.message', { content: 'x' }),
      event(2, 'assistant.started', { messageId: 'a' }),
      event(3, 'text.delta', { messageId: 'a', text: 'y' })
    ]
    const first = projectSession(events)
    const second = projectSession(events)
    check('aynı girdi aynı çıktı', JSON.stringify(first), JSON.stringify(second))
    check('girdi değişmedi', events.length, 3)
  }

  // ============ 5) Diske yazma ve okuma ============
  {
    const dir = join(process.env.EVREN_TEST_DATA as string, 'events')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'session-events.jsonl')
    __setEventsPath(file)
    resetSeqCache()

    const ok1 = await appendSessionEvent({
      seq: nextSeq('s1'),
      sessionId: 's1',
      type: 'session.created',
      data: { modelId: 'm' }
    })
    const ok2 = await appendSessionEvent({
      seq: nextSeq('s1'),
      sessionId: 's1',
      type: 'user.message',
      data: { content: 'merhaba' }
    })
    const ok3 = await appendSessionEvent({
      seq: nextSeq('s1'),
      sessionId: 's1',
      type: 'assistant.started',
      data: { messageId: 'a1' }
    })
    const ok4 = await appendSessionEvent({
      seq: nextSeq('s1'),
      sessionId: 's1',
      type: 'text.delta',
      data: { messageId: 'a1', text: 'selam' }
    })

    check('tüm yazmalar başarılı', [ok1, ok2, ok3, ok4], [true, true, true, true])

    const { bySession, skipped } = await readEvents()
    check('oturum grubu', bySession.size, 1)
    check('dört olay', bySession.get('s1')?.length, 4)
    check('okuma bozuk değil', skipped, 0)

    const projected = await projectStoredSession('s1')
    check('projeksiyon mesaj sayısı', projected.messages.length, 2)
    check('kullanıcı içeriği', projected.messages[0]?.content, 'merhaba')
    check('asistan içeriği', projected.messages[1]?.content, 'selam')
    check('son sıra 4', projected.lastSeq, 4)
  }

  // ============ 6) Bozuk satır tüm dosyayı düşürmez ============
  {
    const dir = join(process.env.EVREN_TEST_DATA as string, 'events')
    const file = join(dir, 'session-events.jsonl')
    const fs = await import('fs/promises')
    await fs.appendFile(file, 'bu bir json degil\n', 'utf8')
    await fs.appendFile(file, '{"seq":5}\n', 'utf8')

    const { bySession, skipped } = await readEvents()
    check('bozuk satırlar atlandı', skipped, 2)
    check('sağlam olaylar korundu', bySession.get('s1')?.length, 4)
  }

  // ============ 7) Sıra numarası devamı ============
  {
    resetSeqCache()
    const projected = await projectStoredSession('s1')
    check('günlükten sıra tohumlandı', projected.lastSeq, 4)
    check('sonraki sıra 5', nextSeq('s1'), 5)

    seedSeq('s2', 100)
    check('elle tohumlama', nextSeq('s2'), 101)
  }

  // ============ 8) Yazma hatası akışı durdurmaz ============
  {
    __setEventsPath(join(dirname('C:/'), 'yetkisiz', 'x', 'y.jsonl'))
    const ok = await appendSessionEvent({
      seq: 1,
      sessionId: 's3',
      type: 'session.created',
      data: {}
    })
    check('yazma hatası false döner (fırlatmaz)', ok, false)
    __setEventsPath(null)
  }

  console.log(`TOTAL=40 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
