/**
 * Alt ajan kapısı — eşzamanlılık ve istek başına kota.
 *
 * ## Neden
 *
 * 0.4.5'e kadar alt ajan sayısı **sınırsızdı**: model `spawn_agent`'ı kaç kez
 * çağırırsa o kadar koşu başlıyordu. Tek bir kötü istem ya da agresif model,
 * sağlayıcı hız sınırını ve yerel kaynakları tüketebilirdi.
 *
 * ## Davranış
 *
 * - **Eşzamanlılık** (`maxConcurrent`, varsayılan 6): aynı anda koşan alt ajan
 *   sayısı. Kapasite dolduğunda yeni istek **kuyruğa** girer; bir slot
 *   boşalınca FIFO sırasıyla devam eder.
 * - **İstek başına toplam** (`maxPerRequest`, varsayılan 6): tek bir sohbet
 *   isteğinde açılabilecek alt ajan sayısı. Bu bir **bütçedir**, kuyruk
 *   değildir: aşılınca istek hemen reddedilir ve modele açıklama döner.
 *
 * Kuyruk ile bütçe ayrımı bilinçlidir. Bütçe aşımı modelin planlama hatasıdır
 * (sonsuz fan-out), kuyruk ise yalnızca zamanlama sorunudur.
 *
 * Bu modül saftır (zamanlayıcı dışında IO yok); `agent-subagent-limit-test`
 * ile doğrulanır.
 */

import {
  MAX_CONCURRENT_SUBAGENTS,
  MAX_SUBAGENTS_PER_REQUEST
} from '../../shared/agentTopology'
import { MAX_FANOUT_CONCURRENCY } from '../../shared/agentFanout'

export interface SubagentGateOptions {
  maxConcurrent?: number
  maxPerRequest?: number
  /** Kuyrukta en fazla bu kadar beklensin (ms). 0 = sınırsız. */
  queueTimeoutMs?: number
}

export type GateRejection = 'per-request' | 'aborted' | 'timeout'

export interface GateAcquireError extends Error {
  reason: GateRejection
}

export interface GateSnapshot {
  active: number
  queued: number
  /** İstek başına ayrılmış toplam slot (bütçe tüketimi). */
  used: Record<string, number>
  maxConcurrent: number
  maxPerRequest: number
}

interface QueueEntry {
  requestId: string
  resolve: () => void
  reject: (error: GateAcquireError) => void
  timer?: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
}

export interface SubagentGate {
  /**
   * Slot ister. Kapasite varsa hemen çözülür, yoksa kuyruğa girer.
   * Reddedilirse `reason` alanlı hata fırlatır.
   */
  acquire: (requestId: string, signal?: AbortSignal) => Promise<void>
  /** Slotu bırakır; kuyruktaki ilk isteği çalıştırır. */
  release: (requestId: string) => void
  snapshot: () => GateSnapshot
  /** Test için: tüm sayaçları sıfırlar. */
  reset: () => void
}

function gateError(reason: GateRejection, message: string): GateAcquireError {
  const error = new Error(message) as GateAcquireError
  error.reason = reason
  return error
}

export function createSubagentGate(options: SubagentGateOptions = {}): SubagentGate {
  // Varsayılan 2: canlı koşuda 4 ajan + ana ajan aynı anda istek atınca
  // sağlayıcı "slow_down" (ramp-rate) döndürdü ve 11 retry oluştu.
  // Ramp-rate limiti istek sayısından değil, artış HIZINDAN tetiklenir.
  const maxConcurrent = Math.max(
    1,
    Math.min(
      MAX_CONCURRENT_SUBAGENTS,
      Math.round(options.maxConcurrent ?? MAX_FANOUT_CONCURRENCY)
    )
  )
  const maxPerRequest = Math.max(
    1,
    Math.round(options.maxPerRequest ?? MAX_SUBAGENTS_PER_REQUEST)
  )
  const queueTimeoutMs = Math.max(0, Math.round(options.queueTimeoutMs ?? 300_000))

  let active = 0
  const used = new Map<string, number>()
  const queue: QueueEntry[] = []

  const drain = (): void => {
    while (queue.length > 0 && active < maxConcurrent) {
      const entry = queue.shift()
      if (!entry) break
      if (entry.timer) clearTimeout(entry.timer)
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort)
      }
      active += 1
      entry.resolve()
    }
  }

  const acquire = (requestId: string, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(gateError('aborted', 'İstek iptal edildi; alt ajan başlatılmadı.'))
    }

    const already = used.get(requestId) ?? 0
    if (already >= maxPerRequest) {
      return Promise.reject(
        gateError(
          'per-request',
          `Bu istek için alt ajan bütçesi doldu (${maxPerRequest}/${maxPerRequest}). ` +
            'Mevcut sonuçlarla devam et; yeni alt ajan açma.'
        )
      )
    }

    // Slot, istek anında ayrılır: 6 kez hızlı çağrı yapılırsa 7.si
    // kuyruğa değil, doğrudan bütçe reddine düşer.
    used.set(requestId, already + 1)

    if (active < maxConcurrent && queue.length === 0) {
      active += 1
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { requestId, resolve, reject, signal }

      if (queueTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const index = queue.indexOf(entry)
          if (index >= 0) queue.splice(index, 1)
          // Bütçe geri verilir: slot hiç kullanılmadı.
          const current = used.get(requestId) ?? 1
          if (current <= 1) used.delete(requestId)
          else used.set(requestId, current - 1)
          reject(
            gateError(
              'timeout',
              `Alt ajan sırası ${Math.round(queueTimeoutMs / 1000)} sn içinde açılmadı.`
            )
          )
        }, queueTimeoutMs)
      }

      if (signal) {
        entry.onAbort = (): void => {
          const index = queue.indexOf(entry)
          if (index >= 0) queue.splice(index, 1)
          if (entry.timer) clearTimeout(entry.timer)
          const current = used.get(requestId) ?? 1
          if (current <= 1) used.delete(requestId)
          else used.set(requestId, current - 1)
          reject(gateError('aborted', 'İstek iptal edildi; alt ajan başlatılmadı.'))
        }
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }

      queue.push(entry)
    })
  }

  const release = (_requestId: string): void => {
    active = Math.max(0, active - 1)
    drain()
  }

  const snapshot = (): GateSnapshot => ({
    active,
    queued: queue.length,
    used: Object.fromEntries(used),
    maxConcurrent,
    maxPerRequest
  })

  const reset = (): void => {
    active = 0
    used.clear()
    for (const entry of queue.splice(0)) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(gateError('aborted', 'Kapı sıfırlandı.'))
    }
  }

  return { acquire, release, snapshot, reset }
}

/**
 * `spawn_agent` reddedildiğinde modele dönen metin.
 *
 * Modelin anlaması gereken şey: bu geçici bir arıza değil, **bütçe**.
 * Yeniden denemek yerine elindekiyle devam etmeli.
 */
export function limitMessage(
  error: unknown,
  snapshot?: GateSnapshot,
  requestId?: string
): string {
  const reason = (error as GateAcquireError | undefined)?.reason
  const detail =
    reason === 'per-request'
      ? 'İstek başına alt ajan bütçesi doldu.'
      : reason === 'timeout'
        ? 'Alt ajan sırası zaman aşımına uğradı.'
        : reason === 'aborted'
          ? 'Koşu iptal edildi.'
          : 'Alt ajan başlatılamadı.'
  let stats = ''
  if (snapshot) {
    const used = requestId ? (snapshot.used[requestId] ?? 0) : undefined
    const parts: string[] = []
    if (used !== undefined) parts.push(`kullanılan: ${used}/${snapshot.maxPerRequest}`)
    parts.push(`etkin: ${snapshot.active}/${snapshot.maxConcurrent}`)
    if (snapshot.queued > 0) parts.push(`kuyruk: ${snapshot.queued}`)
    stats = ` (${parts.join(', ')})`
  }
  return `${detail}${stats} Elindeki sonuçlarla devam et; yeni alt ajan açma.`
}
