# Doğrulama — 0.4.22 üç fazlı canlı sınama (1. koşu)

Tarih: 17 Kasım 2026 · Model: `deepseek-v4.1-flash` · Bellek: **0 kayıt**

## Sonuç: 24/24 kontrol geçti

| Faz | Süre | Araç | Alt ajan | Kısmi | Yanıt | Yönlendirme | Paralel | Ön okuma |
|---|---|---|---|---|---|---|---|---|
| 1 — proje incelemesi | 1269 sn | 83 | 4/5 | 1/4 | 8580 kr | 0 | **14/38** | ölçülmedi* |
| 2 — web araştırması | 617 sn | 55 | 3/5 | 0/3 | 7145 kr | 0 | **13/31** | ölçülmedi* |
| 3 — kodlama | 154 sn | 11 | 2/2 | 0/0 | 540 kr | 0 | 1/2 | ölçülmedi* |
| **Toplam** | **2040 sn** | 149 | 9/12 | 1/7 | | 0 | **28/71** | |

\* Ölçüm hatası: test `EVREN_SUBAGENT_LOG_DIR` ortam değişkenini **okuyor ama
ayarlamıyordu**, bu yüzden ön okuma sayacı hep 0 gösterdi. Ön okumanın gerçekten
çalıştığı `prefetch-live-test` ile ayrıca kanıtlandı (8/8): iki dosya okundu,
alt ajana gitti, gerçek içerik (ALFA-ICERIK/BETA-ICERIK) bağlamda, arayüze
yansıdı. Düzeltildi; sonraki koşuda doğru ölçülecek.

## Sürüm karşılaştırması

| Sürüm | Toplam | Adım ort. | Kısmi | Paralel | Yönlendirme |
|---|---|---|---|---|---|
| 0.4.17 | 3375 sn | 88 sn | 4/7 | yok | 2 (yanlış) |
| 0.4.18 | 5629 sn | 88 sn | 4/6 | yok | 2 (yanlış) |
| 0.4.19 | 2447 sn | 37,7 sn | **0/6** | yok | 0 |
| **0.4.22** | **2040 sn** | — | 1/7 | **28 tetik / 71 çağrı** | **0** |

0.4.19'a göre **%17 daha hızlı** (2447 → 2040 sn).

## Paralel araç gerçekten çalıştı

Loglarda 28 paralel yürütme, toplam 71 çağrı:

```
[explore/sub-11fc579d/step] paralel araç: 6 çağrı · 3 eşzamanlı
[explore/sub-11fc579d/step] paralel araç: 4 çağrı · 3 eşzamanlı
[explore/sub-f3ce73bc/step] paralel araç: 4 çağrı · 3 eşzamanlı
```

0.4.20'de bu sayı 3'tü (hepsi 2 çağrılık). Alt ajan içi paralellik (0.4.21)
asıl kazancı burada sağladı — ajanlar artık 4-6 okumayı tek adımda yapıyor.

## Faz 3 (kodlama) — 154 sn

```
general kabul files=["src/sicaklik.ts"] sicaklik.ts formül düzeltmesi
sicaklik düzeltildi: true · nem düzeltildi: true
```

0.4.19'da 140 sn, 0.4.17'de 387 sn. Dosya sahipliği doğru dağıtıldı.

## Kalan gözlem

- Faz 1'de 1/4 kısmi sonuç var (ajan bütçesi). Diğer fazlarda kısmi yok.
- Faz 2'de 5 spawn denemesinden 3'ü kabul: 2'si eşzamanlılık/kuyruk koruması
  tarafından reddedildi ve model toparladı (doğru davranış).
- Ön okuma ölçümü düzeltildi; 2. koşuda gerçek sayı görülecek.

## Ortam doğrulaması

Kurulu asar içinde: `updateButtonState`, `prefetchFiles`, `toolParallelism`,
`MAX_REPORT_WORDS`, `isCoordinationProgress` — yani 0.4.22 tüm düzeltmeleri
içeriyor.
