import { listWorkspaceChanges } from '../workspace'
import type { WorkspaceChange } from '../../shared/types'

/**
 * `review` alt ajanı için **taze bağlam** inceleme paketi (0.4.24).
 *
 * ## Neden
 *
 * Claude Code'un `/code-review` komutu kodu yazan konuşmayı hiç görmemiş bir
 * alt ajanda inceleme yapar: yazarın akıl yürütmesi denetçiyi ikna etmez.
 * Bizde `review` ajanı zaten salt-okunur ve geçmişsiz çalışıyordu; eksik olan
 * **neyi inceleyeceği**ydi. Ajan ya ana ajanın tarifine güveniyor ya da
 * değişiklikleri kendisi keşfetmeye çalışıp adım bütçesini yakıyordu.
 *
 * Çözüm: bu oturumda yapılan değişikliklerin diff'ini hazır bağlama koy.
 * Ajan dosyaları yeniden okumak zorunda kalmaz; doğrudan kanıta bakar.
 *
 * ## Sınır
 *
 * Brief **değişiklik yoksa boş döner** — o zaman ajan normal görevini yapar.
 * Görev belirli dosyaları adlandırıyorsa brief yalnızca ek bağlam olur;
 * talimat bunu açıkça söyler (aksi hâlde ajan yanlış kapsamı inceler).
 */

const DEFAULT_MAX_CHARS = 12_000
const MAX_DIFF_CHARS = 4_000

export interface ReviewBriefInput {
  path: string
  action: string
  diff: string
}

export interface ReviewBrief {
  text: string
  files: string[]
  /** Brief'e sığmayan dosya sayısı. */
  omitted: number
}

function actionLabel(action: string): string {
  return action === 'write'
    ? 'yazıldı'
    : action === 'edit'
      ? 'düzenlendi'
      : action === 'delete'
        ? 'silindi'
        : action
}

/**
 * Brief'i **saf** olarak biçimlendirir (test edilebilir; dosya sistemi yok).
 */
export function formatReviewBrief(
  changes: ReviewBriefInput[],
  maxChars = DEFAULT_MAX_CHARS
): ReviewBrief {
  const files = changes.map((change) => change.path)
  if (changes.length === 0) return { text: '', files: [], omitted: 0 }

  const list = changes
    .slice(0, 30)
    .map((change) => `- ${change.path} (${actionLabel(change.action)})`)
    .join('\n')

  const header =
    'Aşağıda **bu oturumda** yapılan değişiklikler var. Görev belirli dosyaları ' +
    'adlandırıyorsa onları incele; adlandırmıyorsa bu değişiklikleri incele. ' +
    'Diff yeterli değilse dosyayı `read_file` ile açabilirsin.\n\n' +
    `Değişen dosyalar (${changes.length}):\n${list}\n`

  let body = ''
  let omitted = 0
  for (const [index, change] of changes.entries()) {
    const diff = String(change.diff ?? '').trim()
    if (!diff) continue
    const block =
      `\n--- ${change.path} (${actionLabel(change.action)}) ---\n` +
      (diff.length > MAX_DIFF_CHARS
        ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff kısaltıldı)`
        : diff)
    if (header.length + body.length + block.length > maxChars) {
      omitted = changes.length - index
      break
    }
    body += block
  }

  const footer =
    omitted > 0
      ? `\n\n_(${omitted} dosyanın diff'i sığmadı; gerekirse tek tek oku.)_`
      : ''

  return {
    text: `${header}${body}${footer}`,
    files,
    omitted
  }
}

/**
 * Bu oturumdaki değişiklikleri okuyup brief üretir. Hata durumunda boş döner:
 * inceleme ajanı briefsiz de çalışabilir, spawn'ı düşürmemeli.
 */
export async function buildReviewBrief(
  options: { limit?: number; maxChars?: number } = {}
): Promise<ReviewBrief> {
  try {
    const changes: WorkspaceChange[] = await listWorkspaceChanges(options.limit ?? 30)
    return formatReviewBrief(
      changes.map((change) => ({
        path: change.path,
        action: change.action,
        diff: change.diff
      })),
      options.maxChars
    )
  } catch {
    return { text: '', files: [], omitted: 0 }
  }
}
