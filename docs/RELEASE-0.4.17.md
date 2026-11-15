# 0.4.17 Beta — ilerleme koruması okumayı "ilerleme" saymıyordu

Bellek temizlenmiş hâlde aynı sorgu 0.4.16 ile yeniden koşuldu: **Code Mode
düzeltmesi tuttu** (boş sonuç artık başarı sayılmıyor, 15/15 kontrol geçti),
ama canlı koşu başka bir kusuru ortaya çıkardı.

## Bulgu

İki koşunun ikisinde de yönlendirme, model **dosya okurken** tetiklendi:

```
[general/-/spawn] Firmware analizi … (3 alt ajan açıldı)
[warn] İlerlemesiz döngü: 4 adım metinsiz — yönlendirme #1
[warn] İlerlemesiz döngü: 5 adım metinsiz — yönlendirme #2
```

Yönlendirme *"yeni tarama başlatma, araç çağırmayı bırak"* diyor. Model uydu;
ilk koşuda inceleme 1886 kr'lik yarım raporla bitti ve **sıfır alt ajan**
açıldı — oysa istem açıkça *"maksimum seviyede alt ajan kullan"* diyordu.

## Kök neden

`shouldNudgeProgress` yalnızca **metin uzunluğuna** bakıyordu:

```ts
return window.every((step) => step.tools.length > 0 && step.contentLength === 0)
```

Dosya okuyan adım da "metinsiz" olduğu için ilerlemesiz sayılıyordu. Oysa
kullanıcı içerik istemişti ve **okuma tam olarak ilerlemedir**.

## Düzeltme

1. `StepObservation.productiveReads` eklendi.
2. **Okuma = ilerleme:** adımda en az bir başarılı, içerik üreten okuma varsa
   (`read_file`, `grep`, `glob`, `list_files`, `run_command`, `execute`,
   `webfetch`, `websearch`, `code_search`, `repo_map`, `usb_devices`) o adım
   ilerlemesiz sayılmaz.
3. **Sert eşik (güvenlik ağı):** okuma olsa bile **8** ardışık metinsiz adımda
   yönlendirme yine gönderilir — sonsuz okuma döngüsü engellenir.
4. `stalledStreak` okumada durur; günlük gerçek takılmayı gösterir.
5. Aynı ölçüm alt ajanda da bağlandı (`subagent.ts`).

`isProductiveRead(tool, ok, contentLength)` saf fonksiyon: başarısız çağrı
(<40 karakter) okuma sayılmaz, böylece hata alan model hâlâ yönlendirilir.

## Bellek sınaması (istenen)

`%APPDATA%\EVREN Desktop Beta\memory\memory.bin` (442 KB, 14 Kasım) yedeklenip
silindi; uygulama temiz kapatıldı. Koşu **0 hafıza kaydıyla** başladı — test
bunu ayrıca doğruluyor. Rapordaki hiçbir iddia önceki oturumların hafızasından
gelmiyor.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `progress-guard-test` | 44 (önceki 30) | Okumalı/okumasız adımlar, sert eşik, okuma tanımı |
| `progress-nudge-e2e-test` | 7 | Uçtan uca yönlendirme |
| `code-mode-empty-test` | 17 | Boş Code Mode sonucu |
| `websearch-parse-test` | 86 | Arama |
| `subagent-deadline-test` | 12 | Akış bütçesi |

Toplam: **68 paket / 1636 kontrol** (önceki 68/1622). typecheck ✓ build ✓ e2e ✓

## Canlı koşular (0.4.16, düzeltme öncesi kod — kusuru kanıtlıyor)

| | 1. koşu | 2. koşu |
|---|---|---|
| Süre | 476 sn | 1127 sn |
| Araç | 4 | 21 |
| Alt ajan | **0** | 2 (biri kısmi) |
| Boş `execute` | 0 | 0 |
| Yanıt | 1886 kr | 3959 kr |
| Yönlendirme | 4. adımda | 4. ve 5. adımda |

İkinci koşuda Code Mode düzeltmesi çalıştı: 1 `execute`, boş sonuç yok, gerçek
dosya kanıtı (`/durum`, `haier_kare`), uydurma uç nokta yok, yanlış "erişim
kısıtı" gerekçesi yok. Ayrıca `general` ajanı akış bütçesine takıldı ve **kısmi
sonuç** döndürdü (0.4.15 bütçe düzeltmesi çalışıyor).

## Bilinen sınırlar

- `gemma-4-31b` alt ajan kullanımında tutarsız: aynı istemle bir koşuda 0,
  başka koşuda 3 ajan. Model davranışı; istem tarafında zorunluluk ileride
  güçlendirilebilir.
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
