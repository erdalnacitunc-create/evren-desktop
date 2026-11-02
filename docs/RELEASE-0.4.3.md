# 0.4.3 Beta

## Bu sürümde: kalıcı retry gerçekten çalışıyor

0.4.2 yayınlandıktan sonra aynı USB sorgusu altı modelle paralel çalıştırıldı
(11694 olay, 0 bozuk satır, 6/6 tamamlandı). Koşu, 0.4.1'de eklenen bir
özelliğin **hiç çalışmadığını** ortaya çıkardı.

### Bulgu

mimo oturumu 3 kez yeniden denedi ("Model şu anda dolu" / HTTP 429). Olay
günlüğünde retry'ler görünüyordu ama `sessions.json` içinde **tek bir**
`retry` alanı bile oluşmamıştı.

**Neden:** asistan mesajı akış *bitince* kaydediliyor, retry bilgisi ise akış
*sürerken* yazılmak isteniyordu. Mesaj henüz yokken yazma sessizce boşa
gidiyordu. İki kod yolu vardı (`chat.ts` ve ajan döngüsü) ve ikisinde de aynı
boşluk vardı.

### Düzeltme

- Tek ortak uygulama: `src/main/retryState.ts`
- İlk retry'de **yer tutucu** asistan mesajı açılır (OpenCode da mesajı akış
  başında oluşturur), retry bilgisi oraya yazılır
- Başarılı turda retry alanı **mesaj güncellenirken** silinir — ayrı bir
  "temizle" yazımı `persist()` ile yarışıp eski değeri geri getiriyordu
- Akış metinsiz hata verirse boş yer tutucu kaldırılır

### Artık ne görüyorsunuz

Uygulama kapansa bile retry durumu geçmişte kalır: oturumu açtığınızda
"yeniden deneniyor (2), 8 sn" gibi kalan süreyle bildirim görünür. Başarıyla
bitince kaybolur.

## Canlı doğrulama: 0.4.2 düzeltmeleri işe yaradı

Aynı koşuda önceki sürümün düzeltmeleri de sınandı.

**Ürün adı.** gemma aynı model, aynı sorgu, aynı tek araç:

| 0.4.1 | 0.4.2+ |
|---|---|
| ❌ "ASIX Gigabit Ethernet" | ✅ "C-Media Audio — Ses adaptörü" |
| "VID_2B7E&B597 kimlikli bir aygıt" | ✅ "USB 2.0 HD UVC WebCam" |

**Hafıza kirliliği.** Açılışta 6 geçici anı işaretlendi. ASIX'in geçtiği her
yanıt bir düzeltme oldu:

> "Eski gözlemlerle çelişki var: `VID_0B05&PID_6206` artık ASIX Ethernet
> değil, C-Media USB ses cihazı. Araç sonucu esas alındı." — mimo

**Komut sarmalama.** 32 araç çağrısının 1'i `powershell` içeriyor, o da doğru
desen (`-File betik.ps1`). `$_` bozulması sıfır.

**Araç önerisi.** `run_code` çağrısı sıfır (önceki koşuda 1 hata).

**İlerleme yönlendirmesi.** 3 kez tetiklendi, her seferinde model rapora
geçti; kesin ikinci uyarı hiç gerekmedi.

**Verimlilik.** deepseek önceki koşuda 30 araç / 19.1 dk ve 21 araç / 11.0 dk
harcamıştı. Şimdi aynı model: 8 araç / 5.9 dk ve 7 araç / 3.7 dk.

## Doğrulama
- **47 test paketi / 1023 kontrol** (önceki: 46/1012)
- Yeni: `persist-retry-test` — sahte sağlayıcı 429 döner, retry kayda yazılır,
  başarıdan sonra temizlenir
- typecheck ✓ · build ✓ · e2e ✓

## Bilinen sınırlar
- Retry metni sınıflandırılmış olabilir ("Sunucu istek sınırı"); sağlayıcının
  ham mesajı her zaman korunmaz.
- Kısmi sarmalama (`cd X; powershell -Command "…"`) çözülmüyor.
- Geçicilik sınıflandırması sezgiseldir.
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir.
