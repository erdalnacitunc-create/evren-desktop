import { utilityProcess, type UtilityProcess } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import {
  createMessage,
  decodeMessage,
  encodeMessage,
  type TransportMessage
} from '../transport/protocol'

/**
 * Ajan süreci gözetmeni.
 *
 * `utilityProcess.fork()` ile `out/main/agentWorker.js` başlatılır. Taşıma
 * `postMessage` üzerinden NDJSON satırlarıdır; protokol katmanı soket
 * kullanımıyla aynıdır.
 *
 * Bu adımda yalnızca yaşam döngüsü: başlat, bekle, ping at, kapat. İstek
 * yönlendirmesi sonraki adımlarda eklenecek.
 */

const log = createLogger('agent/process')

export interface AgentProcessOptions {
  /** İşçi modülünün yolu. Varsayılan: ana süreç dosyasının yanındaki agentWorker.js */
  modulePath?: string
  /** Başlatma zaman aşımı (ms). */
  startTimeoutMs?: number
  /** İşçi stdio'sunu devral (hata ayıklama için). */
  inheritStdio?: boolean
}

export interface AgentProcessStatus {
  running: boolean
  pid: number | undefined
  startedAt: number | null
  requests: number
  lastError?: string
}

interface PendingRequest {
  resolve: (message: TransportMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class AgentProcess {
  private child: UtilityProcess | null = null
  private pending = new Map<string, PendingRequest>()
  private startedAt: number | null = null
  private requestCount = 0
  private lastError: string | undefined
  private ready = false
  private starting: Promise<void> | null = null
  private readonly options: AgentProcessOptions

  constructor(options: AgentProcessOptions = {}) {
    this.options = options
  }

  /** İşçiyi başlatır; `spawn` olayını bekler. Tekrar çağrılırsa aynı sözü döndürür. */
  start(): Promise<void> {
    if (this.ready && this.child) return Promise.resolve()
    if (this.starting) return this.starting

    const modulePath = this.options.modulePath ?? defaultWorkerPath()
    if (!existsSync(modulePath)) {
      // Sessizce "exit code 1" görmek yerine anlaşılır hata ver.
      this.lastError = `Ajan işçisi bulunamadı: ${modulePath}`
      return Promise.reject(new Error(this.lastError))
    }

    this.starting = new Promise<void>((resolve, reject) => {
      const timeoutMs = this.options.startTimeoutMs ?? 15_000

      const timer = setTimeout(() => {
        this.lastError = 'Ajan süreci zamanında başlamadı'
        reject(new Error(this.lastError))
      }, timeoutMs)

      let child: UtilityProcess
      try {
        child = utilityProcess.fork(modulePath, [], {
          serviceName: 'EVREN Agent',
          stdio: this.options.inheritStdio ? 'inherit' : 'ignore'
        })
      } catch (error) {
        clearTimeout(timer)
        this.lastError = error instanceof Error ? error.message : String(error)
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      this.child = child

      child.once('spawn', () => {
        clearTimeout(timer)
        this.ready = true
        this.startedAt = Date.now()
        log.info(`Ajan süreci başladı — pid=${child.pid}`)
        resolve()
      })

      child.on('message', (raw: unknown) => this.onMessage(raw))

      child.on('exit', (code: number) => {
        const wasReady = this.ready
        this.ready = false
        this.startedAt = null
        this.child = null
        this.starting = null
        log.warn(`Ajan süreci kapandı — kod=${code}`)
        this.failAllPending(new Error(`Ajan süreci kapandı (kod ${code})`))
        if (!wasReady) {
          // Başlamadan öldü: başlatma sözü asla çözülmemeli.
          clearTimeout(timer)
          this.lastError = `Ajan süreci başlatılamadı (kod ${code})`
          reject(new Error(this.lastError))
        }
      })

      child.on('error', (type: string, location: string) => {
        this.lastError = `${type} @ ${location}`
        log.error(`Ajan süreci hatası — ${this.lastError}`)
      })
    }).finally(() => {
      if (!this.ready) this.starting = null
    })

    return this.starting
  }

  private onMessage(raw: unknown): void {
    const text = typeof raw === 'string' ? raw : String(raw ?? '')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const decoded = decodeMessage(line)
      if (!decoded.ok) {
        log.warn(`İşçiden geçersiz çerçeve: ${decoded.error.message}`)
        continue
      }
      const message = decoded.message
      const waiter = this.pending.get(message.id)
      if (!waiter) {
        // Kimsenin beklemediği yanıt (geç gelen) sessizce atılır.
        continue
      }
      clearTimeout(waiter.timer)
      this.pending.delete(message.id)
      waiter.resolve(message)
    }
  }

  private failAllPending(error: Error): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer)
      this.pending.delete(id)
      waiter.reject(error)
    }
  }

  /** İşçiye mesaj yollar. Süreç yoksa hata verir. */
  send(message: TransportMessage): void {
    if (!this.child) throw new Error('Ajan süreci çalışmıyor')
    this.child.postMessage(encodeMessage(message))
  }

  /**
   * İstek gönderir ve eşleşen `response`/`error` mesajını bekler.
   * Zaman aşımında söz reddedilir; bekleyen kayıt temizlenir.
   */
  async request(
    method: string,
    payload: unknown,
    timeoutMs = 30_000
  ): Promise<TransportMessage> {
    if (!this.child) await this.start()
    if (!this.child) throw new Error('Ajan süreci başlatılamadı')

    this.requestCount += 1
    const id = `req-${Date.now().toString(36)}-${this.requestCount}`
    const message = createMessage('request', id, { method, payload })

    return new Promise<TransportMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Ajan isteği zaman aşımına uğradı: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send(message)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** ping → pong turu; süreç canlı mı? */
  async ping(timeoutMs = 5_000): Promise<{ pid?: number; uptimeMs?: number; protocol?: number }> {
    const message = await this.request('ping', {}, timeoutMs)
    if (message.kind === 'error') {
      throw new Error(`ping hatası: ${JSON.stringify(message.payload)}`)
    }
    return (message.payload ?? {}) as { pid?: number; uptimeMs?: number; protocol?: number }
  }

  status(): AgentProcessStatus {
    return {
      running: this.ready && !!this.child,
      pid: this.child?.pid,
      startedAt: this.startedAt,
      requests: this.requestCount,
      lastError: this.lastError
    }
  }

  /** İşçiyi düzgünce kapatır. */
  async stop(timeoutMs = 3_000): Promise<void> {
    const child = this.child
    if (!child) {
      this.failAllPending(new Error('Ajan süreci çalışmıyor'))
      return
    }

    try {
      await this.request('shutdown', {}, timeoutMs)
    } catch {
      // yanıt gelmezse zorla kapat
    }

    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), timeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    try {
      child.kill()
    } catch {
      // zaten kapanmış olabilir
    }

    await exited
    this.ready = false
    this.child = null
    this.startedAt = null
  }
}

/** `out/main/agentWorker.js` — ana süreç paketiyle aynı klasörde. */
function defaultWorkerPath(): string {
  return join(__dirname, 'agentWorker.js')
}

let shared: AgentProcess | null = null

/** Uygulama genelinde tek ajan süreci. */
export function agentProcess(): AgentProcess {
  if (!shared) shared = new AgentProcess()
  return shared
}

export async function stopAgentProcess(): Promise<void> {
  if (!shared) return
  const instance = shared
  shared = null
  await instance.stop()
}
