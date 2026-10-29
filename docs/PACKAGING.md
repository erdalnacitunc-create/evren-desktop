# Windows Paketleme

## Gereksinimler

- Windows 10/11 x64
- Node.js 20+ (geliştirmede Node 24 kullanıldı)
- `npm ci`

## Paket üretme

```powershell
npm ci
npm run build:win
```

Çıktılar `release/` altında oluşur:

- `EVREN-Desktop-Setup-0.2.3-x64.exe` — NSIS kurulum dosyası
- `win-unpacked/` — kurulum gerektirmeyen çalıştırılabilir sürüm

## Yapılandırma

`package.json` içindeki `build` bölümü:

- `appId`: `com.evren.desktop`
- `productName`: `EVREN Desktop`
- `files`: yalnızca `out/` ve `package.json` (asar içinde)
- `extraResources`: `resources/` (ikon, plugin host, bilgisayar yardımcısı)
- `win.target`: NSIS x64
- `nsis`: kullanıcı bazlı kurulum, dizin seçimi, masaüstü/başlangıç kısayolu

## Temiz kullanıcı verisi

Kaynak paketleme kullanıcı verisi içermez. Paketlenmiş beta uygulaması ayrı bir
profil kullanır:

```text
%APPDATA%\EVREN Desktop Beta
```

Böylece geliştirme sırasında `%APPDATA%\evren-desktop` altında oluşan API
anahtarları, oturumlar ve GitHub token’ları paketle sürüklenmez.

## İmzalama

Bu beta yapı **kod imzalama sertifikası olmadan** üretilir. Windows SmartScreen
uyarı gösterebilir. Üretim sürümü için:

- Authenticode sertifikası
- `CSC_LINK` / `CSC_KEY_PASSWORD` ortam değişkenleri
- veya Azure Trusted Signing / EV sertifikası

## Doğrulama

```powershell
.\release\win-unpacked\EVREN Desktop.exe
```

- İlk açılışta onboarding görünmeli.
- Ayarlar boş olmalı; API anahtarı/token/session olmamalı.
- `%APPDATA%\EVREN Desktop Beta` yeni oluşmalı.
- Terminal, MCP, GitHub ve önerilen yanıtlar paket içinde çalışmalı.
