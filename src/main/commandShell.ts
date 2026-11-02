/**
 * Komut yürütme kabuğu — iç içe PowerShell sarmalamasını çözme.
 *
 * ## Sorun
 *
 * `runWorkspaceCommand` Windows'ta komutu zaten PowerShell içinde
 * `-EncodedCommand` ile çalıştırır. Model ise komutu sık sık **tekrar**
 * `powershell -Command "..."` ile sarmalar:
 *
 *   powershell -Command "Get-PnpDevice | Where-Object { $_.Status -eq 'OK' }"
 *
 * Dış katman PowerShell olduğu için bu dizeyi ayrıştırırken çift tırnak
 * içindeki `$_` değişkenini **kendi kapsamında** açar. Üst kapsamda `$_`
 * tanımsız olduğundan boşalır ve iç komut şu hale gelir:
 *
 *   Where-Object { .Status -eq 'OK' }
 *   → "The term '.Status' is not recognized..."
 *
 * Canlı koşuda 5 araç hatasının 4'ü tam olarak bu nedenden çıktı.
 *
 * ## Çözüm
 *
 * `cmd.exe` ile çalıştırmak ilk akla gelen çözüm ama Windows tırnak kuralları
 * yüzünden kırılgan (Node'un argüman kaçışı ile cmd'nin `/c` ayrıştırması
 * çakışıyor: `exit 7` bile 0 dönüyor). Onun yerine sarmalayıcıyı **çözüyoruz**:
 * dış katman zaten PowerShell olduğu için iç betiği doğrudan çalıştırmak
 * yeterli. Böylece komut bir kez ayrıştırılır ve `$_` doğru kapsamda açılır.
 *
 * `-File` ile çalıştırma çözülmez: dosya yolu içinde değişken açılımı yoktur
 * ve doğrudan yürütmek daha hızlıdır.
 */

/** PowerShell çağrısı olarak kabul edilen ilk belirteçler. */
function isPowerShellToken(token: string): boolean {
  const cleaned = token
    .replace(/^["']|["']$/g, '')
    .replace(/^&\s*/, '')
    .trim()
  const base = cleaned.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return base === 'powershell' || base === 'pwsh' || base === 'powershell.exe' || base === 'pwsh.exe'
}

/**
 * `"..."` veya `'...'` içindeki betiği çıkarır.
 * PowerShell'in kendi kaçış biçimleri (`""`, `''`) ve Windows'un `\"`
 * geleneği normalize edilir.
 */
function unquote(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/""/g, '"')
      .replace(/\\"/g, '"')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

/**
 * Komutun tamamı tek bir iç içe `powershell -Command "..."` çağrısıysa
 * iç betiği döndürür; değilse `null`.
 *
 * Yalnızca "komutun tamamı sarmalanmış" durumu çözülür. Kısmi sarmalama
 * (`cd X; powershell -Command "..."`) olduğu gibi bırakılır: orada iç betiği
 * çıkarmak komşu komutların sırasını bozabilir.
 */
export function unwrapNestedPowerShell(command: string): string | null {
  if (!command) return null
  const trimmed = command.trim()
  if (!trimmed) return null

  // İlk belirteç PowerShell mi? (`& powershell ...` de kabul.)
  const stripped = trimmed.replace(/^&\s+/, '')
  const firstStop = stripped.search(/\s/)
  const firstToken = firstStop === -1 ? stripped : stripped.slice(0, firstStop)
  if (!isPowerShellToken(firstToken)) return null

  // Satır içi betik bayrağını bul: -Command / -c (ama -File değil).
  const flag = /\s-(?:command|c)(?=\s|:)/i.exec(trimmed)
  if (!flag) return null

  let rest = trimmed.slice(flag.index + flag[0].length)
  // `-Command:"..."` biçimi.
  rest = rest.replace(/^\s*:/, '')
  const inner = unquote(rest)
  if (!inner.trim()) return null

  // Çözülen betik hâlâ iç içe PowerShell çağrısı içeriyorsa dokunma:
  // tek geçişte çözmek yeterli, zincirleme çözmek sürpriz üretebilir.
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(inner)) return null

  return inner
}

/**
 * Komutun `$` karakteri içerip içermediğini söyler (tanılama için).
 */
export function hasPowerShellVariables(command: string): boolean {
  return /\$[_a-zA-Z{(@]/.test(command)
}
