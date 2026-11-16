# Doğrulama kaydı — 0.4.19 üç fazlı canlı sınama

Bu belge bir sürüm notu değil, **doğrulama kaydıdır**. 0.4.19 kodu (rapor
bütçesi + koordinasyon ilerlemesi) yüklü uygulamayla üç fazlı canlı sınama
koşuldu; sonuçlar ve üç sürümün karşılaştırması burada tutulur.

## Sonuç: 24/24 kontrol geçti

| Faz | Süre | Araç | Alt ajan | Kısmi | Yanıt | Yönlendirme |
|---|---|---|---|---|---|---|
| 1 — proje incelemesi | 1400 sn | 89 | 3/3 | **0/3** | 9174 kr | 0 |
| 2 — web araştırması | 907 sn | 50 | 3/5 | **0/3** | 4684 kr | 0 |
| 3 — kodlama | 140 sn | 11 | 2/2 | 0/2 | 622 kr | 0 |

## Üç sürümün karşılaştırması (aynı sorgular, aynı model)

| | 0.4.17 | 0.4.18 | **0.4.19** |
|---|---|---|---|
| Toplam süre | 3375 sn | 5629 sn | **2447 sn** |
| Adım başına ortalama | 88 sn | 88 sn | **37,7 sn** |
| Kısmi sonuç (faz 1+2) | 4/7 | 4/6 | **0/6** |
| En uzun ajan | 482 sn | 1297 sn | **542 sn** |
| Yönlendirme (yanlış) | 2 | 2 | **0** |
| Faz 3 süresi | 387 sn | 589 sn | **140 sn** |

0.4.19'un iki düzeltmesi birlikte çalıştı:
- **Rapor bütçesi (450 kelime)** → adım başına süre 88 → 38 sn, kısmi sonuç
  4/6 → **0/6**.
- **Koordinasyon ilerlemesi** → yanlış yönlendirme 2 → **0**.

Alt ajan raporları 450 kelime sınırında kaldı ama içerik kaybı olmadı: faz 1
raporu 9174 kr ile önceki koşularla (9621, 12 748) aynı mertebede.

## Faz 2'deki iki ret — ikisi de meşru

Model üç konuyu üç ajana vermek istedi, sistem iki kez reddetti:

1. **Eşzamanlılık sınırı (90 sn kuyruk).** Dördüncü ajan sırası açılmadı.
   Mesaj modeli doğru yönlendirdi: *"önce `task_wait` ile çalışanlardan birini
   al, sonra bu ajanı aç."* Model bunu yaptı, ilk ajan bitince aynı görevi
   başarıyla açtı.
2. **Yinelenen görev.** Model aynı istemi ikinci kez gönderdi; sistem
   reddetti (*"bu görev zaten başlatıldı"*). Model mevcut sonuçla devam etti.

Yani retler hata değil, koruma katmanlarının çalışması. Toplam 5 spawn
denemesinden 3'ü kabul, 2'si reddedildi ve her ikisinde de model toparlandı.

## Alt ajan süre dökümü

| Ajan | Toplam | Adım | Araç | Adım ort. |
|---|---|---|---|---|
| Faz 1 · firmware protokol | 253 sn | 8 | 16 | 36 sn |
| Faz 1 · firmware ağ | 261 sn | 7 | 13 | 44 sn |
| Faz 1 · Flutter mobil | 240 sn | 11 | 23 | 24 sn |
| Faz 2 · açık kaynak projeler | 193 sn | 10 | 16 | 21 sn |
| Faz 2 · MQTT/TLS | 130 sn | 3 | 2 | 65 sn |
| Faz 2 · bulut vs yerel | 542 sn | 10 | 17 | 60 sn |

Araç süresi toplamı hâlâ <%2; kalan zaman modelin üretiminde. Rapor bütçesi
bunu 88 → 38 sn'ye indirdi.

## Kalan gözlem

Faz 2'deki "bulut vs yerel köprü" ajanı 542 sn sürdü (diğerleri 130-193 sn).
Tek adımı 186 sn — model bu konuda daha uzun düşünüyor. Kısmi sonuç yok, ama
bu ajan diğerlerinden 3 kat yavaş. Bütçe (600 sn) hâlâ yeterli; ileride
konu bazlı efor ayarı düşünülebilir.

## Bilinen sınırlar

- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
- Alt ajan bütçesi 600 sn; çok daha derin araştırma `task_continue` ile
  sürdürülür (bu koşuda gerekmedi — hiç kısmi sonuç yoktu).
