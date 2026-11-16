import { cpus, freemem, totalmem } from 'os'

/**
 * Donanım profili — paralelliği makinenin gücüne göre ayarlar.
 *
 * ## Neden
 *
 * Anthropic'in çoklu ajan yazısı paralel araç çağrısının araştırma süresini
 * %90'a kadar kısalttığını ölçüyor; OpenAI Agents SDK da bağımsız işleri
 * `asyncio.gather` ile paralel çalıştırmayı öneriyor. Ama bu öneriler bulut
 * sunucusu varsayar.
 *
 * EVREN masaüstünde çalışır ve **düşük bellekli / düşük çekirdekli** makineler
 * hedef kitle: Pardus kurulu ofis bilgisayarları, 4 GB RAM'li dizüstüler.
 * Bu makinelerde 4 paralel PowerShell süreci diski ve belleği döver, net
 * sonuç **yavaşlama** olur. Bu yüzden paralellik sabit değil, ölçülür.
 *
 * ## Profiller
 *
 * | Çekirdek | RAM | Araç paralelliği | Alt ajan eşzamanlılığı |
 * |---|---|---|---|
 * | ≤2 veya ≤4 GB | 1 | 1 (seri) |
 * | 3-4 veya ≤8 GB | 2 | 2 |
 * | ≥6 ve ≥12 GB | 3 | 2 |
 *
 * Alt ajan eşzamanlılığı en fazla 2'de kalır: sağlayıcı ramp-rate limiti
 * (0.4.5'te 4 ajan + ana ajan "slow_down" döndürdü) hâlâ geçerli.
 *
 * Saf hesaplama (`profileFor`) test edilebilir; `detectHardware` yalnızca
 * `os` okur.
 */

export interface HardwareInfo {
  /** Mantıksal çekirdek sayısı. */
  cores: number
  /** Toplam RAM (GB). */
  totalRamGb: number
  /** Boştaki RAM (GB). */
  freeRamGb: number
}

export interface PerformanceProfile {
  /** Aynı adımda paralel çalıştırılabilecek salt-okunur araç sayısı. */
  toolParallelism: number
  /** Eşzamanlı alt ajan sayısı. */
  subagentConcurrency: number
  /** Tek bir araç sonucunun modele giren azami karakter sayısı. */
  maxToolOutputChars: number
  /** Eski turlarda araç çıktısı bu uzunluğa indirilir. */
  staleToolOutputChars: number
  /** Profil adı (günlük/tanılama). */
  tier: 'low' | 'mid' | 'high'
}

/** Makinenin çekirdek ve bellek bilgisi. */
export function detectHardware(): HardwareInfo {
  const list = cpus() ?? []
  return {
    cores: Math.max(1, list.length),
    totalRamGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    freeRamGb: Math.round((freemem() / 1024 ** 3) * 10) / 10
  }
}

/**
 * Donanıma göre performans profili.
 *
 * Kural: **en zayıf halka belirler.** Çekirdek çok ama RAM az ise (ya da tersi)
 * alt profil seçilir; paralellik iki kaynağı da tüketir.
 */
export function profileFor(hardware: HardwareInfo): PerformanceProfile {
  const { cores, totalRamGb, freeRamGb } = hardware

  // Zayıf makine: tek çekirdekli sanal makineler, 4 GB ofis bilgisayarları.
  if (cores <= 2 || totalRamGb <= 4) {
    return {
      toolParallelism: 1,
      subagentConcurrency: 1,
      maxToolOutputChars: 6_000,
      staleToolOutputChars: 400,
      tier: 'low'
    }
  }

  // Orta: 4 çekirdek / 8 GB tipik dizüstü.
  if (cores <= 4 || totalRamGb <= 8) {
    return {
      toolParallelism: 2,
      subagentConcurrency: 2,
      maxToolOutputChars: 10_000,
      staleToolOutputChars: 600,
      tier: 'mid'
    }
  }

  // Güçlü masaüstü. Alt ajan 2'de kalır (ramp-rate).
  // Boş bellek 2 GB'ın altındaysa paralelliği kısmak gerekir.
  const tight = freeRamGb > 0 && freeRamGb < 2
  return {
    toolParallelism: tight ? 2 : 3,
    subagentConcurrency: 2,
    maxToolOutputChars: 12_000,
    staleToolOutputChars: 800,
    tier: 'high'
  }
}

/** Tek çağrıda hesaplanmış profil (süreç ömrü boyunca sabit). */
let cached: PerformanceProfile | null = null

export function performanceProfile(): PerformanceProfile {
  if (!cached) {
    const hardware = detectHardware()
    cached = profileFor(hardware)
    if (process.env['EVREN_DEBUG_PERF'] === '1') {
      console.warn(
        `[perf] ${cached.tier} · çekirdek ${hardware.cores} · RAM ${hardware.totalRamGb} GB ` +
          `(boş ${hardware.freeRamGb}) → araç paralelliği ${cached.toolParallelism}, ` +
          `alt ajan ${cached.subagentConcurrency}, araç çıktısı ${cached.maxToolOutputChars}`
      )
    }
  }
  return cached
}

/** Testler için: önbelleği sıfırlar. */
export function resetPerformanceProfile(): void {
  cached = null
}
