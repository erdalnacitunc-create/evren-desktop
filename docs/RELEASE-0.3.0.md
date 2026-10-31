## 0.3.0 Beta

### Windows x64
- Kurulum: `release/EVREN-Desktop-Setup-0.3.0-x64.exe`
- Portable: `release/EVREN-Desktop-0.3.0-portable-x64.zip`
- Kullanıcı bazlı NSIS kurulumu
- Ayrı beta profili: `%APPDATA%\EVREN Desktop Beta`
- API anahtarı/token/session içermez

### Pardus / Debian x64
- `.deb`: GitHub release asset
- AppImage: GitHub release asset
- Ayrıntılar: `docs/PARDUS.md`

### Bu sürümde yeni

**Güvenlik**
- Tüm IPC kanallarında gönderici doğrulaması: alt çerçeve, yabancı origin ve
  renderer dışı dosya yolları reddedilir
- Headless API token karşılaştırması sabit zamanlı
- Kural tabanlı izinler: komut, yol veya URL başına `allow` / `ask` / `deny`

**Günlük ve tanılama**
- `electron-log` tabanlı yapılandırılmış günlük, 5 MB'ta dönüş
- API anahtarı, GitHub token ve `Bearer` değerleri yazılmadan maskelenir
- Ayarlar → Genel → Günlükler: günlük klasörünü aç

**Sohbet deneyimi**
- Yanıt sürerken mesaj yazma: ajan açıkken araya girme, düz akışta sıraya alma
- İstem geçmişi: `Alt+↑` / `Alt+↓` ile geri/ileri, taslak korunur

**Arayüz**
- Türkçe + İngilizce dil seçimi (Ayarlar → Genel → Dil)
- Gerçek PTY terminali (xterm.js): renkler, imleç, `vim`/`ssh`, doğru `Ctrl+C`

**Araçlar**
- Lighthouse denetimi (`lighthouse_audit`): performans, erişilebilirlik,
  en iyi uygulamalar, SEO

**Mimari**
- Ajan isteğe bağlı olarak ayrı süreçte çalışabilir
  (`EVREN_AGENT_PROCESS=worker`, varsayılan kapalı)
- Oturum deposu arayüz arkasında; tek yazar ilkesi korunur

### Bilinen sınırlar
- Ajan süreci varsayılan olarak kapalıdır; ana süreç yolu kullanılır
- Arayüzün bir bölümü hâlâ yalnızca Türkçe (bkz. `docs/I18N.md`)
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir

