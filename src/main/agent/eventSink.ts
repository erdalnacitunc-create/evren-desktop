import { webContents } from 'electron'
import type { ChatEvent } from '../../shared/types'
import { createLogger } from '../logger'

/**
 * Ajan olaylarının dış dünyaya çıkış noktası.
 *
 * Bugün tek uygulama renderer'a (webContents) yazıyor. Süreç ayrımında aynı
 * arayüzü bir IPC/soket taşıyıcısı dolduracak; ajan döngüsü ve çoklu evren
 * mantığı taşıyıcıyı bilmez.
 */

export interface AgentEventSink {
  emit(event: ChatEvent): void
}

const log = createLogger('agent/sink')

/** Herhangi bir `(event) => void` fonksiyonunu sink'e çevirir (geçiş kolaylığı). */
export function asSink(send: (event: ChatEvent) => void): AgentEventSink {
  return { emit: (event) => send(event) }
}

/** Renderer'a yazan sink. Pencere kapanmışsa olay sessizce düşer. */
export function createWebContentsSink(webContentsId: number): AgentEventSink {
  return {
    emit(event: ChatEvent): void {
      const wc = webContents.fromId(webContentsId)
      if (!wc || wc.isDestroyed()) return
      try {
        wc.send('chat:event', event)
      } catch (error) {
        log.warn('Olay gönderilemedi:', error)
      }
    }
  }
}

/** Testler için: olayları bellekte toplar. */
export function createRecordingSink(): AgentEventSink & {
  events: ChatEvent[]
  clear(): void
  countOf(type: ChatEvent['type']): number
} {
  const events: ChatEvent[] = []
  return {
    events,
    emit(event: ChatEvent): void {
      events.push(event)
    },
    clear(): void {
      events.length = 0
    },
    countOf(type: ChatEvent['type']): number {
      return events.filter((event) => event.type === type).length
    }
  }
}

/**
 * Yalnızca belirli bir isteğe ait olayları geçirir.
 *
 * Aynı pencereye birden fazla istek yazabildiği için karışan bir olay,
 * renderer'da yanlış sohbete metin ekler. Bu sarmalayıcı bunu engeller.
 */
export function createRequestSink(sink: AgentEventSink, requestId: string): AgentEventSink {
  return {
    emit(event: ChatEvent): void {
      if (event.requestId !== requestId) return
      sink.emit(event)
    }
  }
}

/**
 * Olayları sırayla iletir ve `emit` sırasında oluşan hataları yutar.
 * Bir sink hatası ajan döngüsünü durdurmamalıdır.
 */
export function createSafeSink(sink: AgentEventSink): AgentEventSink {
  return {
    emit(event: ChatEvent): void {
      try {
        sink.emit(event)
      } catch (error) {
        log.warn(`Olay işlenemedi (${event.type}):`, error)
      }
    }
  }
}
