# 0.4.19 Beta — alt ajan rapor bütçesi (süre ve kısmi sonuç)

0.4.18 üç fazlı canlı koşusu süre sorununu sayısallaştırdı. Bu sürüm onu
kaynağında çözüyor.

## Ölçüm (0.4.18 temel çizgisi)

Üç fazlı koşu, 94 dakika toplam:

| | |
|---|---|
| Alt ajan adımı başına ortalama | **88 sn** |
| Araç süresi payı | **<%2** (araçlar 0,2–2,7 sn) |
| En uzun tek adım | **503 sn** |
| En uzun ajan | **1297 sn** (yine de kısmi) |
| Faz 2'de kısmi sonuç | **3/3** |

Yani süre araçlarda değil, modelin **tek parçada 4-8 bin karakterlik rapor**
üretmesinde. Bütçeyi artırmak (0.4.18'de 420 → 600 sn) süreyi uzattı, kısmi
sonucu çözmedi; çünkü 600 sn'nin tamamı tek bir üretim turunda tükenebiliyor.

## Düzeltme

1. **Kelime bütçesi (450).** Alt ajan istemine kesin sınır eklendi:
   *"Sonucun en fazla 450 kelime olsun. Uzun paragraf yazma; başlık + madde
   işareti kullan. Kod bloğu dökme, yalnızca `dosya:satır` referansı ver.
   Giriş/sonuç/özet paragrafları yazma."*
2. **Kod tarafında zorlama.** `applyReportBudget()` sonucu 450 kelimeye indirir.
   İstem tek başına yeterli değil — model aşarsa kod keser. Kesme **cümle
   sonunda** yapılır (kelime ortasında değil) ve kısa bir not eklenir.
3. **Sentez ve bütçe uyarısı** aynı sınırı taşır. %75 uyarısı artık
   *"araç çağırmayı bırak, kısa maddeler yaz, en fazla 450 kelime"* diyor.
4. **Erken yazma.** *"3-5 adım içinde bulgu yazmaya başla; tek büyük raporu
   sona bırakma — üretim uzarsa bütçe dolar ve rapor kesilir."*

## Neden 450 kelime

Canlı raporlar zaten 400-900 kelime aralığındaydı; 450, bu proje için bilgi
kaybı yaratmadan üretim süresini kısaltıyor. Madde işaretli yapı aynı bilgiyi
daha az token'la taşır. Uzun düz paragraf hem yavaş üretilir hem modele daha
fazla "doldurma" fırsatı verir.

## Doğrulama

`report-budget-test` (24 kontrol): kelime sayımı, cümle sonunda kesme, madde
listeleri, tam sınır/sınır+1, Türkçe karakterler, kesme notu.

Toplam: **69 paket / 1681 kontrol** (önceki 68/1657). typecheck ✓ build ✓ e2e ✓

Canlı ölçüm: `subagent-report-live-test` — aynı projede üç paralel `explore`
ajanı; kelime, süre, adım ortalaması ve kısmi oran ölçülür.

## Bilinen sınırlar

- 450 kelime bazı görevlerde dar olabilir (çok dosyalı derin inceleme). Model
  eksikleri "doğrulanmadı" diye işaretler; ana ajan gerekirse aracı kendisi
  çağırır.
- Kesme kod tarafında yapıldığında içerik kaybı olur; bu bilinçli bir takas
  (kesilmemiş ama yarım kalmış rapor yerine, sınırlı ama tam bir rapor).
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
