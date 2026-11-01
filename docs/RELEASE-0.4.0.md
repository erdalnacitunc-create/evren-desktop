## 0.4.0 Beta

### Windows x64
- Kurulum: `release/EVREN-Desktop-Setup-0.4.0-x64.exe`
- Portable: `release/EVREN-Desktop-0.4.0-portable-x64.zip`
- Ayrı beta profili: `%APPDATA%\EVREN Desktop Beta`

### Pardus / Debian x64
- `.deb` ve AppImage: GitHub release asset
- Ayrıntılar: `docs/PARDUS.md`

### Bu sürümde: OpenCode davranış eşliği

Bu sürüm, çalışan bir referans uygulamanın (OpenCode 2.2.5) hata yönetimi,
zaman aşımı ve yanıt sürdürme mimarisini birebir aktarır. Ayrıntı:
`docs/OPENCODE-PARITY.md`.

**Zaman aşımı artık üç katmanlı**
- Başlıklar için **5 dakika**, parçalar arası **15 dakika**, toplam süre sınırsız
- Önceki 60 saniyelik eşik **kaldırıldı**: DeepSeek gibi sağlayıcılar akıl
  yürütürken dakikalarca hiçbir bayt göndermeyebilir; 60 sn meşru yanıtları
  kesiyordu

**Hata sınıflandırma (11 sınıf)**
- `RateLimit`, `ProviderInternal`, `Transport`, `InvalidProviderOutput`,
  `UnknownProvider`, `Authentication`, `QuotaExceeded`, `ContentPolicy`,
  `InvalidRequest`, `UnsupportedOperation`, `Timeout`
- `x-should-retry` başlığı her şeyi ezer
- Kota (429/402) throttle'dan ayırt edilir

**Retry zamanlaması**
- 2 → 4 → 8 → 10 → 10 … saniye, **10 deneme**, jitter'lı (toplam ~84 s)
- Zaman aşımına uğrayan deneme için ayrı kota: **3**
- `Retry-After` 15 dakikaya kadar dikkate alınır

**Kesilen yanıt artık sürdürülüyor (en önemli değişiklik)**
- Akış ortada kesilirse metin korunur ve model **kaldığı yerden devam eder**
- Token limitine takılırsa (`finish: length`) aynı şekilde sürdürülür
- Arayüzde "Yanıt kesildi — kaldığı yerden sürdürülüyor" gösterilir
- Düz sohbet, ajan, Çoklu Evren sentezi ve alt ajanlarda geçerli

**Adım sınırı artık varsayılan değil**
- OpenCode gibi: sınır yalnızca agent tanımında (`agent.steps`) verilirse uygulanır
- Sınıra ulaşılınca `MAX_STEPS_PROMPT` gönderilir, araçlar kapanır ve model
  yazılı özet verir; kullanıcı boş ekranla kalmaz

### Doğrulama
- 34 test paketi / **689 kontrol**
- 3 katmanlı zaman aşımı, 66 sınıflandırma/politika kontrolü, kesilme →
  sürdürme (20 kontrol), gerçek 503 dizisi, paralel bekleyen istek

### Bilinen sınırlar
- Retry durumu kalıcı mesaj alanı değil (OpenCode'da öyle); uygulama kapanınca
  geçmişte kalmaz
- Olay günlüğü (durable event log) henüz yok
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir

