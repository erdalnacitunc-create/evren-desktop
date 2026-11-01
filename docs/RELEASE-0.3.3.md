## 0.3.3 Beta

### Windows x64
- Kurulum: `release/EVREN-Desktop-Setup-0.3.3-x64.exe`
- Portable: `release/EVREN-Desktop-0.3.3-portable-x64.zip`
- Ayrı beta profili: `%APPDATA%\EVREN Desktop Beta`

### Pardus / Debian x64
- `.deb` ve AppImage: GitHub release asset
- Ayrıntılar: `docs/PARDUS.md`

### Bu sürümde düzeltilenler

**İstek sonsuza kadar bekleyebiliyordu (asıl düzeltme)**
- `streamCompletion` içinde **hiç zaman aşımı yoktu**: sağlayıcı bağlantıyı
  açıp hiç veri göndermezse istek ne yanıt ne hata üretmeden süresiz bekliyordu.
  Gerçek kullanımda aynı sorgu iki sekmede paralel başlatıldı ve iki oturum da
  yanıtsız kaldı (`sessions.json`: yalnızca kullanıcı mesajı, asistan kaydı yok).
- Artık **boşta kalma koruması** var: 60 saniye boyunca tek bayt gelmezse istek
  iptal edilir, yeniden denenir (en fazla 2 kez) ve ardından
  "Sunucu yanıt vermedi" hatası gösterilir.
- Yavaş ama düzenli akan yanıtlar etkilenmez; sayaç her parçada sıfırlanır.
- Eşik ayarlanabilir: `EVREN_STREAM_IDLE_MS` (varsayılan 60000).

**Tanılama (kendi hatamın düzeltmesi)**
- 0.3.2'de ajan adım loglarını `debug` seviyesinde yazmıştım; paketli sürümde
  seviye `info` olduğu için günlükte **hiçbiri görünmüyordu**. Artık `info`.
- Bir sonraki sorunda `Ayarlar → Genel → Günlükler` gerçek kanıt verir:
  adım numarası, içerik uzunluğu, araç sayısı, bitiş nedeni, sınır olayları.

**Paralel koşular**
- İki eşzamanlı koşuda bekleyen istek artık diğerini etkilemeden hata ile
  kapanır; olaylar ve içerik istek kimliğiyle ayrı kalır.

### Notlar
- 0.3.1 (503 otomatik yeniden deneme, `run_command` sağlamlığı) ve
  0.3.2 (adım sınırında nihai yanıt) düzeltmeleri bu sürümde de var.
- Takılı kalan istekleri yeni sürüme geçmeden **Durdur** ile kapatabilirsiniz.

