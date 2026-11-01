## 0.3.1 Beta

### Windows x64
- Kurulum: `release/EVREN-Desktop-Setup-0.3.1-x64.exe`
- Portable: `release/EVREN-Desktop-0.3.1-portable-x64.zip`
- Ayrı beta profili: `%APPDATA%\EVREN Desktop Beta`

### Pardus / Debian x64
- `.deb` ve AppImage: GitHub release asset
- Ayrıntılar: `docs/PARDUS.md`

### Bu sürümde düzeltilenler

**Geçici sunucu hatalarında otomatik devam**
- 429, 500, 502, 503, 504 ve ağ kopmalarında istek otomatik yeniden denenir
  (en fazla 4 deneme, üstel geri çekilme, `Retry-After` desteği)
- Yanıtın bir kısmı aktıktan sonra kopan bağlantı **tekrar denenmez** —
  metin çiftlenmez; hata açıkça bildirilir
- Arayüzde `Model şu anda dolu (503) — yeniden deneniyor (1/4)` gösterilir ve
  ilk parça geldiğinde kaybolur
- 401/403/404/422 gibi kalıcı hatalar yeniden denenmez

**`run_command` kabuk sağlamlığı**
- Windows'ta komutlar artık `-EncodedCommand` ile geçirilir; modelin ürettiği
  tırnak yoğun, çok satırlı veya `$` değişkenli scriptler bozulmadan çalışır
- Ajanın "kabuk yuttu, geçici dosyaya yazıp yeniden çalıştırıyorum" turu
  büyük ölçüde ortadan kalkar

### Notlar
- Sekme değişiminde akışın durması bu sürümde **yeniden üretilemedi**: gerçek
  arayüz üzerinden (yeni sohbet → gönder → başka sohbete geç → geri dön)
  hem düz hem ajan modunda yanıt akmaya devam etti ve oturuma kaydedildi.
  Yine de görürseniz günlük dosyası artık kanıt sağlar:
  Ayarlar → Genel → Günlükler.

