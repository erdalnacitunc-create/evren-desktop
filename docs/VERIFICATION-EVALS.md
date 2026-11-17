# Doğrulama — eval katmanı: dört tur, dört kusur sınıfı

Tarih: 17 Kasım 2026 · Model: `deepseek-v4.1-flash` · Bellek: 0 kayıt

## Tur 1 — hakem sessizce boş

| # | Senaryo | basic | hakem |
|---|---|---|---|
| 1 | Proje özeti | 1 | **-** |
| 2 | Web araştırması | 1 | **-** |
| 3 | Dürüstlük | 1 | **-** |
| 4 | Araç verimliliği | 0.5 | **-** |
| 5 | Kapsam dışı | 1 | **-** |

**Kusur A:** yanlış API yolu (`/chat/completions` → 404); hata yutuluyordu.
**Kusur B:** `arac-verimliligi` beklentisi yanlıştı (`esp01|flasher` arandı,
gerçek ortam `sonda`).

## Tur 2 — hakem yine boş, ama artık uyarı veriyor

| # | Senaryo | basic | hakem | skor |
|---|---|---|---|---|
| 1 | Proje özeti | 1 | **-** | 1 |
| 2 | Web araştırması | 1 | **-** | 1 |
| 3 | Dürüstlük | 1 | **-** | 1 |
| 4 | Araç verimliliği | **1** | - | 1 |
| 5 | Kapsam dışı | 1 | - | 1 |

5/5 geçti, **ama hakem hâlâ ölçmüyordu.** Günlükte bu kez iz vardı:

```
(uyarı: hakem yanıtı ayrıştırılamadı: {"scores":[{"criterion":"accuracy","score":0.8,"reason":"D
```

**Kusur C — token sınırında kesilen JSON.** `max_tokens: 700` beş ölçüt + uzun
gerekçelere yetmiyor; model tam ortada kesiliyor, `JSON.parse` başarısız oluyor
ve **tüm ölçüm kayboluyor** (kısmi puan bile kurtarılmıyordu).

### Düzeltmeler

1. `max_tokens` 700 → **1400**.
2. Hakem istemi: *"reason en fazla 10 kelime"* — çıktıyı kısaltır, kesilme
   riskini düşürür.
3. **Kısmi kurtarma:** `parseJudgeResponse` artık iki aşamalı — önce tam JSON,
   olmazsa regex ile tamamlanmış `criterion/score` çiftlerini çeker. Kesilen
   yanıttan 3/5 ölçüt kurtarılabiliyor (test: `eval-runner-test` §5).
4. Tekrarlanan ölçüt ilk değeri korur (model bazen aynı ölçütü iki kez yazar).

### Kanıt

`judge-live-test` (6/6): gerçek sağlayıcı, orta kaliteli çıktı →
**beş ölçüt, ağırlıklı 0.30**:

```
accuracy      0.2 — İddialar kanıtla desteklenmiyor; spekülatif ifadeler var
evidence      0.2 — Dosya:satır referansı yok; yalnızca araç özeti
completeness  0.1 — Katmanlar dosya:satır ile açıklanmamış
honesty       0.5 — Belirsizlik kısmen işaretli ama ayrıntısız
efficiency    0.8 — Kısa çıktı; gereksiz çağrı/dolgu görünmüyor
```

`eval-runner-test` **51/51** (kesik JSON kurtarma dahil).

## Dört turun ortak dersi

| Tur | Belirti | Sınıf |
|---|---|---|
| 1 | 404 yutuldu → hakem hiç çalışmadı | sessiz hata |
| 1 | Test beklentisi yanlış (`sonda` vs `esp01`) | yanlış test |
| 2 | Kesik JSON → tüm puan kayboldu | kırılgan ayrıştırma |
| 3 | Boş yanıt → uyarı bile yok | sessiz hata (tekrar) |

Hepsi aynı ailede: **ölçüm sessizce sıfırlanıyor ve yeşil görünüyor.** Kural:
bir ölçüm aracı, ölçemediğinde **başarı göstermemeli**.

## Tur 3 — hakem 2/5 senaryoda çalıştı

| # | Senaryo | basic | hakem | skor |
|---|---|---|---|---|
| 1 | Proje özeti | 1 | **-** | 1 |
| 2 | Web araştırması | 1 | **0.79** | 0.895 |
| 3 | Dürüstlük | 1 | **0.90** | 0.95 |
| 4 | Araç verimliliği | 1 | **-** | 1 |
| 5 | Kapsam dışı | 1 | **-** | 1 |

İlk kez gerçek hakem puanları: dürüstlük **0.90** (accuracy 0.9, honesty 1.0) —
model "dosya yok" deyip uydurmadığında rubrik bunu tam puanlıyor. En zayıf
ölçüt **evidence** (0.7): modelin yanıtları kanıt referansı vermede zayıf.

### Kusur D — boş hakem yanıtı da sessizdi

Üç senaryoda `hakem: -` ama **hiçbir uyarı yoktu**. Sebep: model `content: ""`
döndürdü ve uyarı koşulu `raw.trim().length > 0` idi — boş yanıt hiçbir iz
bırakmadı.

**Düzeltme:**
1. Boş yanıt artık **uyarı** olarak yazılır (`finish_reason` ile birlikte).
2. Boş yanıtta **tek bir tekrar** denemesi (geçici sağlayıcı davranışı).
3. `reasoning_content` dönerse oradan da ayrıştırma denenir.
4. Özete **hakem kapsaması** satırı: `hakem ölçülen: N/M senaryo` — ölçümün
   sessizce yarıya düşmesi bir daha görünmez kalmaz.

## Genel paket

| | |
|---|---|
| Paket | **77/77** |
| Kontrol | **1886** |
| Yeni | `eval-runner-test` 51 · `prefetch-live-test` 8 · `judge-live-test` 6 |
