import type { TransportMessage } from './protocol'
import { createMessage, decodeMessage, encodeMessage } from './protocol'

/**
 * Çift yönlü istek katmanı.
 *
 * Taşıyıcı soyutlaması: `send(line)` ile NDJSON satırı yollar, `onLine`
 * ile gelen satırları alır. Aynı sınıf hem ana süreçte (utilityProcess'e
 * bağlı) hem işçide (parentPort'a bağlı) kullanılır; böylece "kim istek
 * atıyor" simetrik olur.
 *
 * Sorumluluklar:
 * - Giden istekleri kimlikle eşleştirmek (yanıt veya hata çözer)
 * - Zaman aşımı ve iptal
 * - Gelen istekleri işleyiciye yönlendirmek
 * - Bilinmeyen kimlikli yanıtları sessizce atmak
 * - Kapanışta tüm bekleyenleri reddetmek (asılı söz kalmaz)
 */

export interface RpcEndpointOptions {
  /** Satırı taşıyıcıya yaz. */
  send: (line: string) => void
  /** Varsayılan istek zaman aşımı (ms). */
  defaultTimeoutMs?: number
  /** Gelen istekleri işleyen fonksiyon. */
  handler?: (message: TransportMessage) => Promise<unknown> | unknown
  /** Gelen olayları (kind=event) alan dinleyici. */
  onEvent?: (message: TransportMessage) => void  /** Ölçüm/hata ayıklama için. */
  log?: (level: 'warn' | 'info', message: string) => void
}

interface Pending {
  resolve: (message: TransportMessage) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

export class RpcEndpoint {
  private pending = new Map<string, Pending>()
  private counter = 0
  private closed = false
  /** Gelen olayları işleyen dinleyici (değiştirilebilir). */
  eventHandler: ((message: TransportMessage) => void) | undefined
  private readonly options: RpcEndpointOptions

  constructor(options: RpcEndpointOptions) {
    this.options = options
    this.eventHandler = options.onEvent
  }

  /** Gelen NDJSON satırını işler. Taşıyıcı her satırı buraya verir. */
  handleLine(line: string): void {
    if (!line.trim()) return
    const decoded = decodeMessage(line)
    if (!decoded.ok) {
      this.options.log?.('warn', `Geçersiz çerçeve: ${decoded.error.message}`)
      return
    }
    this.handleMessage(decoded.message)
  }

  private handleMessage(message: TransportMessage): void {
    // Yanıt veya hata: bekleyen bir isteği çözer.
    if (message.kind === 'response' || message.kind === 'error') {
      const waiter = this.pending.get(message.id)
      if (!waiter) {
        // Geç gelen veya iptal edilmiş istek; sessizce at.
        return
      }
      if (waiter.timer) clearTimeout(waiter.timer)
      this.pending.delete(message.id)
      waiter.resolve(message)
      return
    }

    if (message.kind === 'event') {
      this.eventHandler?.(message)
      return
    }

    if (message.kind === 'request') {
      void this.runHandler(message)
      return
    }

    // cancel/ping/pong: çağıran katman kendi anlamını yükler.
    this.eventHandler?.(message)
  }

  private async runHandler(message: TransportMessage): Promise<void> {
    const handler = this.options.handler
    if (!handler) {
      this.reply(
        createMessage('error', message.id, {
          payload: { message: `İşleyici yok: ${String(message.method)}`, code: 'no-handler' }
        })
      )
      return
    }
    try {
      const result = await handler(message)
      this.reply(createMessage('response', message.id, { payload: result }))
    } catch (error) {
      this.reply(
        createMessage('error', message.id, {
          payload: {
            message: error instanceof Error ? error.message : String(error),
            code: (error as { code?: string })?.code ?? 'handler-error'
          }
        })
      )
    }
  }

  /** Ham mesaj gönderir (olay, pong vb.). */
  emit(message: TransportMessage): void {
    if (this.closed) return
    this.options.send(encodeMessage(message))
  }

  /** Yanıt gönderir; kapalıysa sessizce yutar. */
  reply(message: TransportMessage): void {
    this.emit(message)
  }

  /**
   * İstek gönderir ve yanıtı bekler.
   * `error` türü yanıt da sözü çözer; çağıran `kind` kontrolü yapar.
   * `timeoutMs <= 0` süresiz bekler (uzun süren ajan koşuları için).
   */
  async request(
    method: string,
    payload: unknown,
    timeoutMs?: number
  ): Promise<TransportMessage> {
    if (this.closed) throw new Error('Taşıyıcı kapalı')

    this.counter += 1
    const id = `rpc-${Date.now().toString(36)}-${this.counter}`
    const message = createMessage('request', id, { method, payload })
    const effectiveTimeout = timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000
    const unbounded = effectiveTimeout <= 0

    return new Promise<TransportMessage>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null
      if (!unbounded) {
        timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`İstek zaman aşımı: ${method}`))
        }, effectiveTimeout)
      }

      this.pending.set(id, {
        resolve,
        reject,
        timer: timer ?? undefined
      })

      try {
        this.options.send(encodeMessage(message))
      } catch (error) {
        if (timer) clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Bekleyen istek sayısı (test/gözlem için). */
  pendingCount(): number {
    return this.pending.size
  }

  /** Kapanış: bekleyen tüm istekler reddedilir. */
  close(reason = 'Taşıyıcı kapandı'): void {
    if (this.closed) return
    this.closed = true
    for (const [id, waiter] of this.pending) {
      if (waiter.timer) clearTimeout(waiter.timer)
      this.pending.delete(id)
      waiter.reject(new Error(reason))
    }
  }

  isClosed(): boolean {
    return this.closed
  }
}
