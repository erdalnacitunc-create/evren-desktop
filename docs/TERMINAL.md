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
