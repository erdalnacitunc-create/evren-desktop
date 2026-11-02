## 0.4.1 Beta

### Windows x64
- Kurulum: `release/EVREN-Desktop-Setup-0.4.1-x64.exe`
- Portable: `release/EVREN-Desktop-0.4.1-portable-x64.zip`
- Ayrı beta profili: `%APPDATA%\EVREN Desktop Beta`

### Pardus / Debian x64
- `.deb` ve AppImage: GitHub release asset
- Ayrıntılar: `docs/PARDUS.md`

### Bu sürümde: kalıcı durum ve olay günlüğü

OpenCode'un kalan iki mimari farkı kapatıldı (`docs/OPENCODE-PARITY.md`).

**Kalıcı yeniden deneme durumu**
- Yeniden deneme bilgisi artık mesajın alanı: `retry: { attempt, at, error }`
- Uygulama kapansa bile "3. deneme, 14:32'de" bilgisi kaybolmaz
- Oturum açıldığında son 10 dakika içindeki deneme bildirim olarak gösterilir
  (kalan saniye dahil)
- Sürdürme turları `continuations` alanında sayılır

**Depo göçü (v1 → v2)**
- `sessions.json` artık `{ version, sessions }` biçiminde
- Eski düz dizi dosyaları **bozulmadan** yüklenir; eksik alanlar onarılır,
  bozuk kayıtlar atlanır ve günlüğe yazılır
- Göç idempotenttir; bir kez çalışır, sonra yeni biçim kullanılır
- Hiçbir mesaj/oturum kaybı yok — mevcut kullanıcı verisi korunur

**Kalıcı olay günlüğü**
- Her olay `session-events.jsonl` dosyasına eklenir (satır başına bir olay)
- Olaylar: `session.created`, `user.message`, `assistant.started`,
  `text.delta`, `reasoning.delta`, `retry.scheduled`, `retry.cleared`,
  `continue.started`, `tool.called`, `tool.result`, `step.ended`,
  `assistant.completed`, `assistant.failed`, `session.renamed`
- **Projeksiyon**: oturum yalnızca günlükten yeniden kurulabilir
  (`session:sync`); sonuç depodaki mesajlarla birebir aynı
- Bozuk satırlar tüm dosyayı düşürmez; yalnızca o satır atlanır
- Arayüz oturum açılırken günlükle karşılaştırma yapar ve tutarsızlık varsa
  bildirir

### Doğrulama
- **38 test paketi / 801 kontrol**
- Yeni: göç 32+19, olay günlüğü 40, uçtan uca 21
- Gerçek `startChat` yolundan günlük → projeksiyon → depo eşitliği doğrulandı

### Bilinen sınırlar
- Günlük dosyası sınırsız büyür (döndürme yok); uzun vadede arşivleme gerekir
- Arayüz şu an günlükten otomatik yeniden kurmuyor; yalnızca tutarsızlığı
  bildiriyor (tam yeniden kurma sonraki adım)
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir
