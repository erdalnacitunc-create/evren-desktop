import { detectProjectChecks, runProjectChecks } from '../checks'
import type { CheckResult } from '../../shared/types'

/**
 * Doğrulama kapısı (0.4.24).
 *
 * ## Neden
 *
 * 0.4.23 eval turunda ve önceki canlı koşularda tekrar eden kusur sınıfı:
 * **başarısızlığı başarı gibi raporlamak**. `general` alt ajanı dosya yazıp
 * "tamamlandı" diyordu; typecheck/test hiç çalışmıyordu. Ana ajan da alt
 * ajanın raporuna güvenmek zorundaydı.
 *
 * Claude Code'un `Stop` hook'u tam bunu çözer: tur bitmeden *harness*
 * (model değil) bir kontrol çalıştırır ve geçmezse modeli geri gönderir.
 * Anthropic'in kendi sınıflandırmasıyla bu **deterministik** bir kısıttır;
 * istemle rica etmek "deterministik olmayan" tarafta kalır ve garanti vermez.
 *
 * ## Tasarım sınırları
 *
 * - Kapı yalnızca **yazma yapan** ajanlarda ve yalnızca **yazma olduysa**
 *   çalışır. Salt-okunur ajanlar için maliyet sıfır.
 * - `build` otomatik kapıda **çalışmaz**: yavaş ve genelde typecheck/testin
 *   kapsadığı hataları tekrar eder. Model isterse `run_checks` ile çalıştırır.
 * - Kontrol tanımlı değilse "geçti" denmez; **"doğrulanmadı"** denir. Bu,
 *   0.4.16 dersinin aynısı: ölçemeyen araç başarı göstermemeli.
 */

/**
 * Yazma yapabilecek araçlar. Yalnızca bunlar kapıyı tetikler.
 *
 * `run_command` / `run_python` **kasıtlı olarak dâhil**: bir betik, `git
 * checkout`, kod üreteci veya `npm install` doğrudan yazma araçlarını hiç
 * kullanmadan çalışma alanını değiştirebilir. Değişiklik günlüğü bu yolu
 * görmez (yalnızca `write_file`/`edit_file` kayıt altına alınır), bu yüzden
 * kapıyı yalnızca doğrudan yazma araçlarına bağlamak sessiz bir kaçış
 * bırakırdı — kapatmaya çalıştığımız kusurun ta kendisi.
 *
 * Bedeli: komut çalıştırıp bitiren bir `general` ajanında kapı bir kez daha
 * koşar. Yanlışlıkla *fazla* doğrulama, sessizce *eksik* doğrulamadan iyidir.
 */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'patch',
  'delete_file',
  'create_directory',
  'run_command',
  'run_python',
  // Code Mode: içinden yazma araçlarını çağırabilir.
  'execute'
])

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name)
}

export type VerifyMode = 'auto' | 'off'

/**
 * Kapı modu. `EVREN_VERIFY_GATE=off` ile kapatılabilir (kaçış yolu).
 * Varsayılan açık: kapının değeri tam olarak "unutulmaması".
 */
export function verifyGateMode(): VerifyMode {
  return String(process.env['EVREN_VERIFY_GATE'] ?? '').toLowerCase() === 'off' ? 'off' : 'auto'
}

/** Otomatik kapıda çalışan kontroller. `build` bilinçli olarak dışarıda. */
export const GATE_CHECK_NAMES = ['typecheck', 'test'] as const

export function shouldVerify(input: {
  readOnly: boolean
  mutations: number
  mode?: VerifyMode
}): boolean {
  const mode = input.mode ?? verifyGateMode()
  if (mode === 'off') return false
  if (input.readOnly) return false
  return input.mutations > 0
}

export interface VerifyVerdict {
  /** Kontrol gerçekten çalıştı mı? `false` ise sonuç "başarısız" değil "bilinmiyor". */
  ran: boolean
  ok: boolean
  checks: CheckResult[]
  reason?: 'off' | 'no-mutations' | 'no-checks' | 'error'
  error?: string
  durationMs: number
}

function gateTimeoutMs(): number {
  const override = Number(process.env['EVREN_VERIFY_TIMEOUT_MS'])
  return Number.isFinite(override) && override >= 5_000 ? override : 180_000
}

/** Kontrol çıktısını rapora sığacak biçimde kısaltır. */
export function excerpt(text: string, maxChars = 1500): string {
  const value = String(text ?? '').trim()
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n… (çıktı ${value.length} karakterden kısaltıldı)`
}

export async function runVerifyGate(
  names: readonly string[] = GATE_CHECK_NAMES,
  options: { timeoutMs?: number } = {}
): Promise<VerifyVerdict> {
  const startedAt = Date.now()
  try {
    const available = await detectProjectChecks()
    const selected = available.filter((check) => names.includes(check.id))
    if (selected.length === 0) {
      return {
        ran: false,
        ok: false,
        checks: [],
        reason: 'no-checks',
        durationMs: Date.now() - startedAt
      }
    }
    const timeoutMs = Math.min(
      gateTimeoutMs(),
      Math.max(5_000, Math.round(options.timeoutMs ?? gateTimeoutMs()))
    )
    const checks = await runProjectChecks(
      selected.map((check) => check.id),
      { timeoutMs }
    )
    return {
      ran: checks.length > 0,
      ok: checks.length > 0 && checks.every((check) => check.ok),
      checks,
      reason: checks.length === 0 ? 'no-checks' : undefined,
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    // Kapının kendisi çöktüyse bu "geçti" değildir; bilinmiyor.
    return {
      ran: false,
      ok: false,
      checks: [],
      reason: 'error',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    }
  }
}

function seconds(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))} sn`
}

/**
 * Kapı sonucunu ana ajana giden **kısa ve dürüst** bir bloğa çevirir.
 * Bu blok rapor bütçesinden sonra eklendiği için asla kesilmez.
 */
export function formatVerifyVerdict(verdict: VerifyVerdict): string {
  if (!verdict.ran) {
    if (verdict.reason === 'no-checks') {
      return (
        'DOĞRULAMA: çalıştırılmadı — projede `typecheck`/`test` scripti tanımlı değil. ' +
        'Değişiklikler **doğrulanmadı**.'
      )
    }
    if (verdict.reason === 'off') {
      return 'DOĞRULAMA: kapalı (EVREN_VERIFY_GATE=off). Değişiklikler doğrulanmadı.'
    }
    return (
      'DOĞRULAMA: çalıştırılamadı' +
      (verdict.error ? ` (${excerpt(verdict.error, 300)})` : '') +
      '. Değişiklikler **doğrulanmadı**.'
    )
  }

  const labels = verdict.checks.map((check) => check.label).join(', ')
  if (verdict.ok) {
    return `DOĞRULAMA: ✓ geçti — ${labels} (${seconds(verdict.durationMs)})`
  }

  const failures = verdict.checks
    .filter((check) => !check.ok)
    .map(
      (check) =>
        `✗ ${check.label} (\`${check.command}\`, çıkış ${check.exitCode})\n${excerpt(check.output)}`
    )
    .join('\n\n')
  return `DOĞRULAMA: ✗ **BAŞARISIZ** — ${labels} (${seconds(verdict.durationMs)})\n${failures}`
}

/**
 * Kapı başarısız olduğunda modele geri gönderilen düzeltme istemi.
 *
 * Son kural kritik: "hatayı susturmak için testi gevşetme". Puan/ceza baskısı
 * altında modellerin en sık kısayolu budur (Denison et al., reward tampering).
 * Kapı bunu açıkça yasaklar; ayrıca `run_checks` doğrulaması kod tarafında
 * yeniden çalıştığı için testi silmek işe yaramaz — yalnızca dürüstlüğü bozar.
 */
/**
 * Düzeltme turunda modele verilen **değişmez kurallar**.
 *
 * Son kural kritik: "hatayı susturmak için testi gevşetme". Puan/ceza baskısı
 * altında modellerin en sık kısayolu budur (Denison et al., reward tampering).
 * Kapı bunu açıkça yasaklar; ayrıca kontrol kod tarafında yeniden çalıştığı
 * için testi silmek işe yaramaz — yalnızca dürüstlüğü bozar.
 */
export const VERIFY_RETRY_RULES =
  'KURALLAR:\n' +
  '- Hatayı susturmak için testi/kontrolü silme, gevşetme, `skip` ekleme veya scripti değiştirme.\n' +
  '- Gerçek nedeni düzelt. Düzeltemediğin bir hata varsa raporda açıkça "doğrulanamadı" yaz.\n' +
  '- Kapsam dışı bir dosya düzeltmeyi gerektiriyorsa dosyayı değiştirme; raporda bildir.'

export function verifyRetryMessage(verdict: VerifyVerdict): string {
  return (
    'DOĞRULAMA BAŞARISIZ. Yazdığın değişiklikler proje kontrollerinden geçmedi. ' +
    'Aşağıdaki hataları düzelt ve sonra bitir. Kontrolü kendin çalıştırma; ' +
    'sistem bitirince yeniden çalıştıracak.\n\n' +
    formatVerifyVerdict(verdict) +
    '\n\n' +
    VERIFY_RETRY_RULES
  )
}

/**
 * Ajan kendi `run_checks`'ini çalıştırıp **başarısız** olduysa gönderilen
 * düzeltme istemi. Kapı aynı işi tekrar koşmaz; ajanın kendi kanıtı yeter.
 */
export function selfCheckRetryMessage(content: string): string {
  return (
    'DOĞRULAMA BAŞARISIZ. Kendi çalıştırdığın `run_checks` başarısız oldu. ' +
    'Hatayı düzelt ve sonra bitir.\n\n' +
    excerpt(content) +
    '\n\n' +
    VERIFY_RETRY_RULES
  )
}
