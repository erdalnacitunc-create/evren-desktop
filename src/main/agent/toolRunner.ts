/**
 * Araç yürütme yardımcıları — sınırlı eşzamanlılık.
 *
 * ## Neden sınırlı
 *
 * Anthropic çoklu ajan yazısı alt ajanların **3+ aracı paralel** çağırmasının
 * araştırma süresini %90'a kadar kısalttığını ölçüyor; OpenAI Agents SDK da
 * bağımsız işleri `asyncio.gather` ile paralel çalıştırmayı öneriyor. Ama
 * sınırsız paralellik masaüstünde ters teper: her `run_command` bir PowerShell
 * süreci açar, 4 GB RAM'li bir makinede 8 süreç diski ve belleği döver.
 *
 * Bu yüzden eşzamanlılık **donanım profiline** bağlı (`hardwareProfile.ts`) ve
 * yalnızca **salt-okunur, birbirinden bağımsız** araçlar paralel çalışır.
 *
 * ## Neden yalnızca salt-okunur
 *
 * Aynı adımda `read_file` + `write_file` varsa paralel çalıştırma yarış
 * koşulu yaratır: okuma, yazma bitmeden eski içeriği görebilir. Model normalde
 * bunu tek adımda istemez; ama isterse **sıralı** yürütmek doğru davranıştır.
 * Kural: aynı adımdaki tüm çağrılar güvenli değilse hepsi sırayla koşar.
 */

/** Paralel çalışması güvenli araçlar: yalnızca okuyan, durum değiştirmeyenler. */
const PARALLEL_SAFE_TOOLS = new Set([
  'read_file',
  'list_files',
  'glob',
  'grep',
  'code_search',
  'repo_map',
  'webfetch',
  'websearch',
  'reference',
  'lsp'
])

export function isParallelSafeTool(name: string): boolean {
  return PARALLEL_SAFE_TOOLS.has(name)
}

/**
 * Hazır çağrılar paralel yürütülmeli mi?
 *
 * Koşullar (hepsi):
 *  - eşzamanlılık izni > 1,
 *  - en az iki çağrı,
 *  - **hepsi** paralel güvenli.
 */
export function shouldRunInParallel(
  calls: Array<{ call: { name: string } }>,
  parallelism: number
): boolean {
  if (parallelism <= 1) return false
  if (calls.length < 2) return false
  return calls.every((item) => isParallelSafeTool(item.call.name))
}

/**
 * Diziyi en fazla `limit` eşzamanlı işle yürütür; sonuçlar **girdi sırasında**
 * döner (mesaj sırası deterministik kalır, testler güvenilir olur).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const size = Math.max(1, Math.min(Math.round(limit), items.length))
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await task(items[index] as T)
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()))
  return results
}
