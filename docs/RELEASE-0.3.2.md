## 0.3.2 Beta

### Windows x64
- Kurulum: `release/EVREN-Desktop-Setup-0.3.2-x64.exe`
- Portable: `release/EVREN-Desktop-0.3.2-portable-x64.zip`
- Ayrı beta profili: `%APPDATA%\EVREN Desktop Beta`

### Pardus / Debian x64
- `.deb` ve AppImage: GitHub release asset
- Ayrıntılar: `docs/PARDUS.md`

### Bu sürümde düzeltilenler

**Ajan sessizce susuyordu (asıl düzeltme)**
- Adım (20) veya araç (40) sınırına ulaşınca döngü hiçbir metin üretmeden
  bitiyordu; kullanıcı boş ekranla kalıyordu. Gerçek bir oturumda model
  20 adım boyunca yalnızca düşünüp tek karakter yanıt yazmadı
  (`finish=max-steps`, 0 karakter).
- Artık sınıra ulaşınca modele **araçsız** son bir tur attırılır ve elindeki
  sonuçlarla nihai yanıtı yazması istenir.
- Model yine boş dönerse çalıştırılan araçların özeti gösterilir
  ("Adım sınırına ulaştım… şu araçlar çalıştı… devam et yazabilirsiniz").
- Kullanıcı hiçbir durumda "yanıt yok" ile baş başa kalmaz.

**Tanılama**
- Ajan döngüsü artık günlüğe yazıyor: her adımın numarası, içerik uzunluğu,
  araç sayısı ve bitiş nedeni. Bir sonraki sorunda
  `Ayarlar → Genel → Günlükler` gerçek kanıt verir.

**Ayarlanabilir sınırlar**
- `EVREN_AGENT_MAX_STEPS` (varsayılan 20, en fazla 200)
- `EVREN_AGENT_MAX_TOOL_CALLS` (varsayılan 40, en fazla 400)
- Uzun görevlerde artırmak için uygulamayı bu değişkenlerle başlatın.

### Notlar
- 0.3.1'deki otomatik yeniden deneme (429/5xx) ve `run_command`
  `-EncodedCommand` düzeltmeleri bu sürümde de var.

