# 0.4.9 Beta — kademeli fan-out ve kapsam disiplini

Alt ajan sayısı artık **kapsama göre** seçiliyor ve ajanlar **kademeli**
başlıyor. Amaç: 0.4.8'deki retry fırtınasını ve "kısmi rapor" oranını
düşürmek.

## Önerinizin değerlendirmesi

Öneriniz: *"sorgu kapsamına göre alt ajan sayısını belirle, ajanları tek tek
(darboğaz oluşturmayacak şekilde) başlat."*

**Doğru olan kısım:** sayının kapsama göre seçilmesi. 0.4.8'de model her
sorguda 4 ajan açıyordu; 15 dosyalık iş için bu israf.

**Düzeltilmesi gereken kısım:** "tek tek" (tam seri) yanlış olur. 4 ajan ×
3 dk = 12 dk; paralelliğin tüm faydası kaybolur. Anthropic'in ölçümü:
paralelleştirme karmaşık sorgularda süreyi **%90** kısaltıyor.

**Bizim uyguladığımız orta yol — kademeli fan-out:**

| Kapsam | Ajan | Eşzamanlı |
|---|---|---|
| < 15 dosya | 1 | 1 |
| 15–60 dosya | 2 | 2 |
| > 60 dosya veya 4+ dizin | 3–4 | **2** (2 dalga) |

Yani 4 ajan gerekiyorsa **2+2 dalga** hâlinde çalışır. Süre paralel çalışmaya
yakın kalır, ani istek sıçraması olmaz.

## Neden ani sıçrama önemli — OpenAI rate-limit rehberi

Canlı 0.4.8 koşusunda 4 ajan + ana ajan aynı anda istek attı: **5× ani artış**.
Sağlayıcı `slow_down` (ramp-rate) döndürdü → **11 retry**, koşu 13 dakika.

OpenAI'ın belgesi bunu açıkça söylüyor:

> `429 / rate_limit_error / slow_down` — *"Your request rate increased too
> quickly. Follow Retry-After when present, **reduce your request rate, and
> then increase it gradually**."*

Ve: *"A `slow_down` error can occur even when your traffic is within its
requests-per-minute limits. It reflects **how quickly traffic increased**."*

Yani limit istek **sayısı** değil, artış **hızı**. Bu yüzden eşzamanlılığı
6'dan 2'ye indirdim ve ajanları kademeli başlatıyorum. Hard cap 6 olarak
duruyor (açıkça istenirse).

## İkinci kusur: kapsam disiplini

0.4.8 koşusunda ajanlara `master\` (3 GB) ve `mobil\` (3 GB) dizinleri
verildi. Ajanlar `build`/`node_modules` içinde adım bütçesini yaktı ve
"kısmi" rapor döndürdü.

İki düzeltme:

**1. Kapsam brifingi** — her alt ajanın istemine otomatik ekleniyor:

```
KAPSAM KURALLARI:
- Şu dizinlere GİRME: node_modules, .git, build, dist, out, .dart_tool, .pio, …
- Önce grep/glob ile daralt, sonra yalnızca gereken dosyaları oku.
```

**2. Araç zaman aşımı + sinyal** — alt ajan araçlarına artık `AbortSignal`
geçiyor. Bir `Get-ChildItem -Recurse` 3 GB'lık dizinde dakikalarca sürebiliyordu
ve **durdurulamıyordu**; tek başına ajanın tüm bütçesini tüketiyordu.

- Araç başına azami 90 sn
- Son tarihe 10 sn kala kesilir
- Kesilirse ajan elindekini yazar (`partialReason: 'tool-timeout'`)

## Üçüncü iyileştirme: kısmi sonuç artık yapısal

0.4.8'de ana ajan "kısmi mi" diye metinden tahmin ediyordu; nihai raporda
*"içerik doğrulanamadı"* diye 12 kez yazdı.

Artık `SubagentTaskInfo` üzerinde:

```ts
partial?: boolean
partialReason?: 'steps' | 'tools' | 'deadline' | 'tool-timeout'
```

Ve ana ajana dönen metinde açıkça görünüyor:

```
Alt ajan (explore) sonucu [KISMİ — deadline]:

## Özet — …
```

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `agent-fanout-test` | 42 | Kapsam eşikleri, eşzamanlılık tavanı, kademe, brifing, plc_proje senaryosu |
| `agent-fanout-e2e-test` | 6 | Gerçek döngü: 4 ajan → **tepe eşzamanlılık 2**, 2+2 dalga |

Uçtan uca ölçüm:

```
zaman çizelgesi: 49ms, 49ms, 178ms, 178ms · tepe: 2
```

Yani 4 ajan iki dalga hâlinde gitti; önceki davranışta dördü de 0 ms'de
başlıyordu.

`agent-live-subagent-test` (gerçek model, 30 dosya): 6/6 geçti, sonuç dolu.

Toplam: **58 paket / 1342 kontrol** (önceki: 56/1294). typecheck ✓ build ✓ e2e ✓

## Neden tam seri (önerinizin ilk hâli) değil

| Strateji | 4 ajan süresi | İstek profili |
|---|---|---|
| Tam paralel | ~3 dk | 5× ani sıçrama → retry fırtınası |
| **Kademeli 2+2** | **~4–5 dk** | 3× → 2× kademeli, retry yok |
| Tam seri | ~12 dk | 1× sabit, retry yok |

Kademeli, paralelin hızına yakın; tam seriden 2–3 kat hızlı.

## Sıradaki

0.4.9'u kurup **aynı plc_proje sorgusunu** tekrar çalıştırın. Ölçülecek üç şey:

1. **Retry sayısı** — 11'den kaça düştü?
2. **Kısmi rapor oranı** — 4/4'ten kaça düştü?
3. **Süre** — 13 dakikadan kaça düştü?

Bu üç sayı 4. aşamaya (triage) geçip geçmeyeceğimize karar verecek.
Çoklu Evren entegrasyonu hâlâ sizin belirlediğiniz sırada.
