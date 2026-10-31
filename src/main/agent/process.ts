import { utilityProcess, type UtilityProcess } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { RpcEndpoint } from '../transport/rpc'
import { createSessionHandler } from '../transport/remoteSessionRepository'
import { createMessage, type TransportMessage } from '../transport/protocol'
import { sessions } from '../sessionRepository'

/**
 * Ajan süreci gözetmeni.
 *
 * `utilityProcess.fork()` ile `out/main/agentWorker.js` başlatılır ve
 * çift yönlü bir RPC köprüsü kurulur:
 *  - ana süreç → işçi: istekler (`ping`, `shutdown`, ileride `agent.run`)
 *  - işçi → ana süreç: `session.*` istekleri (işçi dosyaya yazmaz)
 *
 * Oturum istekleri ana süreçte yerel depoya yönlendirilir; tek yazar ilkesi
 * korunur.
 */

const log = createLogger('agent/process')

export interface AgentProcessOptions {
  modulePath?: string
  startTimeoutMs?: number
  inheritStdio?: boolean
}

export interface AgentProcessStatus {
  running: boolean
  pid: number | undefined
  startedAt: number | null
  requests: number
  pending: number
  lastError?: string
}

export class AgentProcess {
  private child: UtilityProcess | null = null
  private rpc: RpcEndpoint | null = null
  private startedAt: number | null = null
  private requestCount = 0
  private lastError: string | undefined
  private ready = false
  private starting: Promise<void> | null = null
  private readonly options: AgentProcessOptions

  constructor(options: AgentProcessOptions = {}) {
    this.options = options
  }

  start(): Promise<void> {
    if (this.ready && this.child) return Promise.resolve()
    if (this.starting) return this.starting

    const modulePath = this.options.modulePath ?? defaultWorkerPath()
    if (!existsSync(modulePath)) {
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

      // İşçiden gelen `session.*` istekleri yerel depoya gider.
      const rpc = new RpcEndpoint({
        send: (line) => child.postMessage(line),
        defaultTimeoutMs: 30_000,
        log: (level, message) => {
          if (level === 'warn') log.warn(message)
        },
        handler: async (message) => {
          const method = String(message.method ?? '')
          if (!method.startsWith('session.')) {
            throw Object.assign(new Error(`Bilinmeyen yöntem: ${method}`), {
              code: 'unknown-method'
            })
          }
          // Önek atılır: createSessionHandler 'list', 'get' gibi adlar bekler.
          const handler = createSessionHandler(await sessions())
          return handler(method.slice('session.'.length), Array.isArray(message.payload) ? message.payload : [])
        }
      })
      this.rpc = rpc

      child.once('spawn', () => {
        clearTimeout(timer)
        this.ready = true
        this.startedAt = Date.now()
        log.info(`Ajan süreci başladı — pid=${child.pid}`)
        resolve()
      })

      child.on('message', (raw: unknown) => {
        const text = typeof raw === 'string' ? raw : String(raw ?? '')
        for (const line of text.split('\n')) rpc.handleLine(line)
      })

      child.on('exit', (code: number) => {
        const wasReady = this.ready
        this.ready = false
        this.startedAt = null
        this.child = null
        this.starting = null
        const activeRpc = this.rpc
        this.rpc = null
        activeRpc?.close(`Ajan süreci kapandı (kod ${code})`)
        log.warn(`Ajan süreci kapandı — kod=${code}`)
        if (!wasReady) {
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

  /** İşçiye ham mesaj yollar. */
  send(message: TransportMessage): void {
    if (!this.child) throw new Error('Ajan süreci çalışmıyor')
    this.child.postMessage(JSON.stringify(message) + '\n')
  }

  /** İstek gönderir; `response` veya `error` mesajı döner. */
  async request(method: string, payload: unknown, timeoutMs?: number): Promise<TransportMessage> {
    if (!this.child) await this.start()
    if (!this.rpc) throw new Error('Ajan süreci başlatılamadı')
    this.requestCount += 1
    return this.rpc.request(method, payload, timeoutMs)
  }

  /** İşçide oturum deposunun uzak olduğunu doğrular. */
  async sessionProbe(): Promise<{ ok: boolean; sessions: number }> {
    const message = await this.request('session.probe', {}, 15_000)
    if (message.kind === 'error') {
      throw new Error(`session.probe hatası: ${JSON.stringify(message.payload)}`)
    }
    return message.payload as { ok: boolean; sessions: number }
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
      pending: this.rpc?.pendingCount() ?? 0,
      lastError: this.lastError
    }
  }

  async stop(timeoutMs = 3_000): Promise<void> {
    const child = this.child
    if (!child) {
      this.rpc?.close('Ajan süreci çalışmıyor')
      this.rpc = null
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
    this.rpc?.close('Ajan süreci durduruldu')
    this.rpc = null
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
