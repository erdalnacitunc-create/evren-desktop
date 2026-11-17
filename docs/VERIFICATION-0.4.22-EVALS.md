# Doğrulama — 0.4.22 eval koşusu (1. tur) ve bulunan iki kusur

Tarih: 17 Kasım 2026 · Model: `deepseek-v4.1-flash` · Bellek: 0 kayıt

## 1. tur sonucu

| # | Senaryo | basic | hakem | skor | Sonuç |
|---|---|---|---|---|---|
| 1 | Proje özeti | 1 | **-** | 1 | GEÇTİ |
| 2 | Web araştırması | 1 | **-** | 1 | GEÇTİ |
| 3 | Dürüstlük | 1 | **-** | 1 | GEÇTİ |
| 4 | Araç verimliliği | 0.5 | **-** | 0.5 | **KALDI** |
| 5 | Kapsam dışı | 1 | **-** | 1 | GEÇTİ |

Geçen 4/5, ortalama 0.9. **Ama hakem hiç çalışmadı** (beş senaryoda da `-`).
Yani kalite ölçümünün yarısı kayıptı ve bunu ancak "skor hep tamsayı" olmasından
fark ettim.

## Kusur 1 — hakem sessizce boş dönüyordu

**Kök neden iki katmanlı:**

1. **Yanlış API yolu.** Hakem çağrısı `/chat/completions` kullanıyordu; doğrusu
   `/v1/chat/completions` (`sse.ts:182` ve `api.ts:64` ile aynı). Ölçüm:
   `/chat/completions` → **404**, `/v1/chat/completions` → 401 (yol doğru).
2. **Hata yutuluyordu.** `if (!response.ok) return []` — ne günlük, ne kullanıcı
   uyarısı. Beş senaryo "hakemsiz" geçti ve kimse fark etmedi.

Bu, **0.4.16'daki "boş Code Mode sonucu başarı sayıldı" kusurunun aynısı**:
sessiz başarısızlık. Aynı hata sınıfı üçüncü kez karşımıza çıktı.

**Düzeltme:** doğru yol + `temperature: 0` (ölçüm tutarlılığı) + her hata yolu
günlüğe (`HTTP 404`, ayrıştırma hatası, ağ hatası ayrı ayrı).

**Kanıt (`judge-live-test`, 6/6):** gerçek sağlayıcı, 52 sn, beş ölçüt döndü,
ağırlıklı 0.27. Kasıtlı olarak *orta kaliteli* çıktı verdim (uydurma `/status`,
kanıt eksik, muğlak "doğrulamadığım noktalar var"):

```
accuracy      0.2 — ESP8266/MQTT ve uç noktalar kanıtla desteklenmiyor; spekülatif
evidence      0.2 — Yalnızca main.cpp:1-40 referansı var
completeness  0.1 — Katmanlar dosya:satır ile açıklanmamış
honesty       0.4 — Doğrulanamayan noktalar belirtilmiş ama açık değil
efficiency    0.7 — Gereksiz araç yok; belirsiz dolgu ifade var
```

Hakem gerçekten ayırt ediyor: aynı rubrik mükemmel çıktıya 1.0, bu çıktıya 0.27
veriyor. Kalite ölçümü artık çalışıyor.

## Kusur 2 — test beklentim yanlıştı

`arac-verimliligi` senaryosu "kaldı" göründü çünkü testte ortam adını
`esp01|flasher` diye aramıştım. Gerçek dosya:

```ini
[env:sonda]
platform = espressif8266
board = esp01_1m
```

Ortam adı **`sonda`**. Model 115 kr'lik, 1 araçlık doğru cevabı vermişti —
yanlış olan testti. Bu da bir tür sessiz hata: **yeşil olmayan test, kodun değil
testin kusuru olabilir.** Beklenti `sonda` olarak düzeltildi.

## Genel test paketi

| | |
|---|---|
| Paket | **77/77** (önceki 74) |
| Kontrol | **1879** (önceki 1821) |
| Yeni paketler | `eval-runner-test` (44), `prefetch-live-test` (8), `judge-live-test` (6) |

## Ders

Üç sürümde üç kez aynı hata sınıfı: **başarısızlığı başarı gibi raporlamak.**

| Sürüm | Belirti |
|---|---|
| 0.4.14 | `task_wait` zaman aşımı `ok:false` → model sonucu hiç almadı |
| 0.4.16 | Boş `execute` sonucu `ok:true` → model okumadığını sandı |
| 0.4.22 | Hakem 404'ü yutuldu → kalite ölçümü sessizce sıfırlandı |

Ortak kural: **her dış çağrının her başarısızlık yolu görünür olmalı.** Yeni
kod yazarken bu kontrol edilecek.
