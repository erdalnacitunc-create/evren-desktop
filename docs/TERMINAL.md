# Terminal

EVREN Desktop'a entegre terminal, sohbetin altında açılır ve seçili çalışma
alanında kalıcı bir PowerShell oturumu çalıştırır.

## Açma

- Sohbet araç çubuğundaki **Terminal**
- `Ctrl + ters tırnak (backtick)`
- Komut paleti (`Ctrl+K`) → **Terminali aç/kapat**

## Özellikler

- Kalıcı shell oturumu; komutlar arasında dizin/ortam değişkenleri korunur.
- Komut geçmişi (`↑` / `↓`).
- **Temizle**, **Ctrl+C** (oturumu yeniden başlatır), **Yeniden başlat**, **Kapat**.
- Çıktı UTF-8; ANSI kodları temizlenir.
- Terminal kapatılınca shell sonlandırılır.
- Çalışma alanı yoksa ev dizininde başlar; bir klasör seçilirse orada açılır.

## Kodu tek tuşla çalıştır

Model yanıtındaki desteklenen kod bloklarında **▶** düğmesi görünür:

- Python (`python`, `py`, `python3`)
- Node.js (`js`, `javascript`, `node`, `mjs`)
- PowerShell (`powershell`, `ps1`, `pwsh`)
- Bash (`bash`, `sh`, `shell`, `zsh`)

Kod, base64 ile shell'e aktarılır; tırnak/kaçış sorunları oluşmaz. Çalıştırma
için **bir çalışma alanı seçili olmalıdır**. Kod bloğu 20.000 karakteri
aşarsa tek tuşla çalıştırma reddedilir.

Örnek:

```python
print("merhaba")
```

Bloktaki **▶** düğmesine basınca terminal açılır, çalışma alanında Python
çalışır ve çıktı terminalde görünür.

## Sınırlar

- Windows'ta varsayılan shell **PowerShell**'dir.
- Gerçek bir PTY yoktur; bu nedenle ilerleme çubukları, renkli TUI uygulamaları
  ve gerçek `Ctrl+C` sinyali sınırlıdır. **Ctrl+C** shell'i yeniden başlatır.
- Çok satırlı etkileşimli komutlar (ör. heredoc) tek satır olarak gönderilmelidir.
- Kod bloğu çalıştırma **doğrudan shell'de** yürür; model çıktısını çalıştırmadan
  önce içeriği kontrol etmek kullanıcının sorumluluğundadır.
- Kod çalıştırma; ajanın izin politikasına veya checkpoint sistemine tabi değildir.
  Bu, kullanıcının açık tıklamasıyla yapılan bir işlemdir.
- Python/Node/Bash kurulu değilse shell hata mesajı gösterir.

## Güvenlik

- Terminal yalnızca yerel süreç çalıştırır.
- Komutlar seçili çalışma alanında başlar; shell'in kendisi işletim sistemi
  kullanıcısının yetkilerine sahiptir.
- API anahtarları terminal ortamına açıkça eklenmez.
- Terminal çıktısı oturum geçmişine kaydedilmez.

## Gerçek PTY (node-pty)

Terminal artık boru (pipe) tabanlı `spawn` yerine **gerçek bir PTY** kullanır:

- `@lydell/node-pty` (platforma özel önceden derlenmiş ikili dosyalar; Windows x64
  ConPTY, Linux x64 pty).
- Arayüz `@xterm/xterm` + `FitAddon` ile çizilir: renkler, imleç, satır düzenleme,
  `vim`/`top`/`ssh` gibi etkileşimli programlar, ilerleme çubukları ve
  `Ctrl+C` doğru çalışır.
- Pencere boyutu değişince `ResizeObserver` → `fit()` → `terminal:ptyResize` ile
  PTY sütun/satır bilgisi güncellenir; kabuk `SIGWINCH` alır.
- Klavye girişi doğrudan PTY'ye yazılır (`terminal:ptyWrite`); satır tamponu,
  geçmiş ve imleç artık kabuğun kendisine aittir.
- `Ctrl+C` = ETX (`\u0003`) gönderir, oturumu kapatmaz. **Yeniden başlat** oturumu
  sonlandırıp aynı klasörde yenisini açar.

### Kanallar

| Kanal | Yön | İçerik |
|---|---|---|
| `terminal:start` | renderer → main | `(cwd, cols, rows)`; `TerminalStatus` döner |
| `terminal:ptyWrite` | renderer → main | Ham klavye verisi |
| `terminal:ptyResize` | renderer → main | Sütun/satır |
| `terminal:stop` | renderer → main | Oturumu kapatır |
| `terminal:interrupt` | renderer → main | ETX gönderir |
| `terminal:raw` | main → renderer | Ham PTY çıktısı (ANSI korunur) |
| `terminal:exit` | main → renderer | `{ code, signal }` |

### Yedek (fallback) davranışı

`@lydell/node-pty` yüklenemezse (desteklenmeyen mimari, eksik prebuild) oturum
**pipe moduna** düşer: aynı panel, eski komut satırı arayüzü ve `terminal:data`
kanalı kullanılır. `TerminalStatus.mode` alanı `'pty'` veya `'pipe'` döner;
arayüz buna göre hangi yüzeyi çizeceğine karar verir. Hata `status.error`
alanında görünür.

### Paketleme

- `package.json` → `build.asarUnpack: ["node_modules/@lydell/**"]`: yerel ikili
  dosyalar ve `OpenConsole.exe` ASAR dışında kalır (yüklenebilmeleri için zorunlu).
- `electron-builder` `@electron/rebuild` adımını çalıştırır; ancak `@lydell/node-pty`
  N-API tabanlı önceden derlenmiş ikili kullandığı için ek derleme gerekmez.

### Doğrulama

```bash
node scripts/run-unit.cjs scripts/pty-test.ts        # 16 senaryo (gerçek kabuk)
node scripts/packaged-check.cjs release/win-unpacked # paket içeriği
```

Paketli uygulamada uçtan uca:

```bash
EVREN_SELFTEST=1 "release/win-unpacked/EVREN Desktop.exe"
# pty_mode=pty running=true / pty_write=true / pty_resize=true
```

### Sınırlar

- Oturum başına tek terminal vardır; sekmeli çoklu terminal yok.
- Panel yüksekliği sabittir (260 px); sürükleyerek boyutlandırma yok.
- Açık tema seçildiğinde xterm renk paleti koyu kalır (okunabilirlik için bilinçli).
- `runTerminalCode` (kod bloğundan tek tuşla çalıştırma) hâlâ pipe oturumunu
  kullanabilir; PTY varsa aynı kabuk üzerinden çalışır.
