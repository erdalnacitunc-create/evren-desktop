# 0.4.16 Beta — Code Mode sessiz başarısızlığı

İki paralel canlı sorgu (aynı istem, farklı modeller) karşılaştırılırken
bulundu. Tek kusur var ama etkisi büyük: **model, kodunun hiçbir şey
yapmadığını anlamıyordu.**

## Kusur

`gemma-4-31b` oturumunda 14 `execute` çağrısının **13'ü** `{}` veya
`undefined` döndürdü — ve hepsi **`ok: true`** olarak raporlandı.

Script'in yaptığı:

```js
const r = await tools.run_command({ command: 'Get-Content "...main.dart"' })
out[file] = r.stdout   // ← undefined: araç { ok, content } döndürür
```

Tüm değerler `undefined` kaldı, `JSON.stringify` `{}` üretti. Araç başarı
dedi. Sonuç:

| | |
|---|---|
| Modelin sandığı | 11 dosyayı okudu |
| Gerçek | **hiçbirini okumadı** |
| Rapor | dosya ADLARINDAN yazıldı |
| Yanlış gerekçe | *"dosya erişim kısıtları yaşandığından"* |
| Uydurma | *"Yüksek ihtimalle `/status` ve `/command` benzeri HTTP uç noktalarına sahiptir"* (gerçek: `/durum`, `/k`, `/bilgi`, `/ayar`) |

Aynı hata sınıfı 0.4.14'te `task_wait` ile yaşanmıştı: sessiz başarısızlık
başarı gibi raporlanınca model yanlış yola sapıyor ve bunu kullanıcıya
"doğrulanamadı" diye yansıtıyor.

## Düzeltme

1. **Boş sonuç artık hata.** `execute`, `undefined` / `null` / boş metin /
   `{}` / `[]` dönerse `ok: false` verir.
2. **Hata mesajı yol gösterir:**
   - `return` yoksa: *"Script bir değer döndürmedi… `return results`"*
   - alan adı yanlışsa: *"`tools.*` çağrıları `{ ok, content }` döndürür —
     `.stdout`, `.body`, `.text` YOKTUR"*
3. **Araç açıklaması** aynı sözleşmeyi baştan yazar; model tahmin etmek
   zorunda kalmaz.

Bu, modelin bir sonraki adımda kendini düzeltmesini sağlar: hata görünür
olduğunda `r.content` yazar veya `read_file` aracına geçer.

## Doğrulama

`code-mode-empty-test` (17 kontrol): `return` yok, yanlış alan (`.stdout`),
boş dizi/metin/`null` → hepsi hata; doğru `r.content` kullanımı, dolu
nesne/dizi → başarı; script istisnası → yakalanıyor.

Toplam: **68 paket / 1622 kontrol** (önceki 67/1605). typecheck ✓ build ✓ e2e ✓

## Karşılaştırma notu (aynı istem, iki model)

| | gemma-4-31b | deepseek-v4.1-flash |
|---|---|---|
| Süre | 720 sn | 1092 sn |
| Araç | 25 (2 hata) | 26 (1 hata) |
| Boş `execute` | **13** | **0** |
| Alt ajan | 3 | 4 |
| Yanıt | 600 kelime, 24 dosya ref | 1124 kelime, 32 dosya ref |
| Çekince | 1 ("doğrulanamadı") | 0 |

deepseek `{ok, content}` sözleşmesini doğru kullandı; gemma `.stdout` varsaydı.
Bu kusur giderildiğinde gemma da kendini düzeltebilir — ancak **alt ajan
sonuçlarını kullanma** konusunda hâlâ zayıftı (3 rapor aldı, raporuna
yansıtmadı). Bu bir model davranışı; istem tarafında "alt ajan raporundaki her
bulguyu ya kullan ya gerekçesiyle ele" kuralı ileride eklenebilir.

## Bilinen sınırlar

- `execute` sonucu 60 000 karakterde kırpılır.
- gemma-4-31b uzun yanıtlarda yer yer bozuk metin üretiyor
  ("Ancak,ftaki karş mobil taraılıklarından"); delta akışı sıralı ve kayıpsız
  — sorun model çıktısında.
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
