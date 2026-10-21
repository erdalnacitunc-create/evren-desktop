# Zamanlanmış Görevler

**Ayarlar > Görevler** sekmesinde, uygulama açıkken çalışacak promptlar
tanımlanabilir. Her çalışma yeni bir sohbet oturumu oluşturur.

## Zamanlama türleri

| Tür | Açıklama |
| --- | --- |
| **Tek seferlik** | Seçilen tarih/saatte bir kez çalışır, sonra duraklatılır. |
| **Aralıklı** | 1–10080 dakika arasında tekrar eder. |
| **Günlük** | Her gün seçilen `HH:mm` saatinde çalışır. |

Görev; ad, prompt ve model içerir. Model listesi sohbet/vision modelleridir.
Görev oluşturulduğunda bir sonraki çalışma zamanı hesaplanır.

## Davranış

- Zamanlayıcı uygulama açıldığında başlar ve 30 saniyede bir due görevleri
  kontrol eder.
- Görev çalışınca:
  1. `Zamanlanmış: <görev adı>` başlıklı **yeni oturum** açılır.
  2. Prompt kullanıcı mesajı olarak eklenir.
  3. Modelden yanıt alınır (stream, arka planda toplanır).
  4. Yanıt oturuma kaydedilir.
  5. Görevde son çalışma zamanı, sonuç önizlemesi ve sonraki zaman güncellenir.
  6. Pencere odakta değilse masaüstü bildirimi gösterilir.
- **Şimdi çalıştır** zamanlamayı beklemeden çalıştırır.
- **Duraklat** görevi devre dışı bırakır; **Etkinleştir** yeniden zamanlar.
- **Sil** görevi kaldırır. Oluşturulan oturumlar silinmez; normal sohbetlerden
  ayrı olarak silinebilir.
- Sonuçlar **Son sonuç** altında genişletilebilir.
- Aynı görev aynı anda iki kez çalışmaz.

## Sınırlar

- Görevler **yalnızca sohbet yanıtı** üretir; dosya/komut/Git araçlarını
  çalıştırmaz. Bu, kullanıcı onayı olmadan yan etki oluşmasını engeller.
- Uygulama kapalıyken çalışmaz; Windows Görev Zamanlayıcı entegrasyonu yoktur.
- Uygulama kapanırken çalışan bir görev tamamlanmaz; `nextRunAt` geçmişte kalırsa
  yeniden açılışta tekrar denenir.
- API anahtarı yoksa veya model kullanılamıyorsa görev hata kaydeder ve sonraki
  zamanlamada tekrar dener.

## Depolama

- Görevler: `%APPDATA%\evren-desktop\scheduled-tasks.json`
- Oluşturulan oturumlar normal oturum deposunda (`sessions`) tutulur.
- API anahtarı ve token’lar bu dosyada yer almaz.

## Gelecek

- Araç kullanımı için isteğe bağlı “ajan modu” + izin politikası.
- Windows Görev Zamanlayıcı / arka planda çalışma.
- Bildirimden doğrudan oturuma gitme.
