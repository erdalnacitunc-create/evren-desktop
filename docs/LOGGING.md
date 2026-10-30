# Günlükler

EVREN Desktop, sorun giderme için yapılandırılmış günlük tutar. Günlükler `electron-log` ile
yazılır ve varsayılan olarak kullanıcı verisi klasörü altındadır.

## Konum

| Platform | Yol |
|---|---|
| Windows | `%APPDATA%\EVREN Desktop Beta\logs\main.log` |
| Linux | `~/.config/EVREN Desktop Beta/logs/main.log` |
| Geliştirme | `EVREN_DATA_DIR` verilmişse `<EVREN_DATA_DIR>\logs\main.log` |

Kesin yolu arayüzden görebilirsiniz: **Ayarlar → Genel → Günlükler → Günlük klasörünü aç**.
Aynı bilgi `app:getLogPath` IPC kanalıyla da alınabilir.

## Davranış

- Dosya 5 MB'a ulaşınca `main.log.1` olarak döner. Tek yedek tutulur.
- Paketlenmiş uygulama `info`, geliştirme `debug` seviyesinde yazar.
- Geliştirmede ayrıca konsola yazar; pakette yalnızca dosyaya yazar.
- Seviye `EVREN_LOG_LEVEL` ortam değişkeniyle değiştirilir
  (`error`, `warn`, `info`, `verbose`, `debug`, `silly`).

## Neler kaydedilir

- Uygulama başlangıcı: sürüm, platform, mimari, paket durumu, günlük yolu
- Renderer çökmesi (`render-process-gone`) ve alt süreç sonlanması (`child-process-gone`)
- Yakalanmayan hatalar ve işlenmeyen Promise redleri
- IPC gönderici doğrulamasından geçmeyen çağrılar (kanal + sebep)
- Modül hataları: oturum kaydı, MCP, eklentiler, zamanlanmış görevler, uzantı deposu

## Gizlilik

Günlüğe yazılmadan önce bilinen sır kalıpları maskelenir (`src/main/logger.ts` → `redact`):

- `sk-…` (API anahtarı)
- `evren_…` (EVREN API anahtarı)
- `ghp_…`, `github_pat_…`, `gho_…` (GitHub token)
- `xox…` (Slack token)
- `Bearer …` başlıkları
- `api_key`, `token`, `secret`, `password`, `authorization` alanlarının JSON/değer biçimi

`Error` nesnelerinin mesajı ve yığını da maskelenir.

> Maskeleme bir güvenlik ağıdır, garanti değildir. Günlük paylaşmadan önce yine de gözden
> geçirin; bilinmeyen biçimdeki sırlar kalıplara takılmayabilir.

## Testler

```bash
npm run test:unit
```

- `scripts/ipc-guard-test.ts` — IPC gönderici doğrulaması (14 senaryo)
- `scripts/logger-test.ts` — sır maskeleme (6 senaryo)

Tek bir testi çalıştırmak için:

```bash
node scripts/run-unit.cjs scripts/logger-test.ts
```

Yardımcı betik TypeScript dosyasını `node_modules/.cache` altına derler ve Electron ile
çalıştırır. Derleme çıktısı proje ağacında kalmalıdır; aksi halde Electron `electron-log`
gibi bağımlılıkları çözemez.

## Destek için günlük toplama

1. Ayarlar → Genel → Günlükler → **Günlük klasörünü aç**
2. `main.log` ve varsa `main.log.1` dosyalarını kopyalayın
3. Sorunun oluştuğu saat aralığını ve uygulama sürümünü not edin

Günlükler kullanıcı adı, dosya yolları ve oturum kimlikleri içerebilir; herkese açık bir
sorunda paylaşmadan önce bunları temizleyin.
