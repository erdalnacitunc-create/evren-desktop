# Yük ve Kaos Sınaması (Eşzamanlılık Kapısı)

Bu belge 0.4.25'te eklenen model istek kapısının **nasıl sınandığını** ve
sınamada ne bulunduğunu anlatır.

## 1. Neden bu yöntem

Kapıyı "kendi sayacı 2 diyor" diye doğrulamak dairesel bir kanıt olurdu. 0.4.24'te
tam bu sınıf bir kusur yaşandı: bir ölçüm aracı ölçemediğini başarı saydı.

Üç kaynak ilkeyi belirledi:

### Chaos Engineering (principlesofchaos.org)

> "Start by defining 'steady state' as some measurable output of a system …
> Focus on the measurable output of a system, rather than internal attributes."

→ Eşzamanlılık, kapının iç sayacından değil, **HTTP sunucusunda** sayılır.
Kapı yanlış saysa bile sunucu doğruyu gösterir.

> "Try to disprove the hypothesis by looking for a difference in steady state."

→ Hipotez "sınır aşılmaz". Onu çürütmeye çalışırız: sınırın **5 katı** yük
göndeririz.

### k6 stress/soak sırası

> "Run stress tests only after smoke and average-load tests."

→ S1 smoke → S2 ortalama → S3 stress → S6 soak. Sıra atlanmaz; aksi hâlde
düşük yükteki bir sorun yüksek yükte aranırken gözden kaçar.

### Değişmez (invariant) doğrulama

Tek bir "≤ N" kontrolü yetersizdir:

- Eşzamanlılığı **1'e düşüren** bir hata bu kontrolü **geçerdi**.
- Bu yüzden hem `≤ N` hem `≥ N` aranır: sınır aşılmamalı **ve** kullanılmalı.
- Ayrıca **açlık** (başlatılan ajan sunucuya ulaştı mı) ve **sızıntı**
  (bitişte slot/kuyruk sıfır mı) ayrı ölçülür.

## 2. Senaryolar

`scripts/model-gate-stress-test.ts`:

| # | Senaryo | Ne kanıtlar |
|---|---|---|
| S1 | smoke, 1 ajan | Temel akış çalışıyor |
| S2 | 3 ajan, sınır 2 | Paralellik gerçekten kullanılıyor (≥ 2) |
| S3 | 10 ajan, sınır 2 (5×) | Sınır aşılmıyor, kimse aç kalmıyor |
| S4 | ana ajan önceliği | Ana ajan alt ajanların önüne geçiyor |
| S5 | kaos: 6 ajan, 3'ü uçuşta iptal | Slot sızmıyor, kilitlenme yok |
| S6 | soak: 5×6 = 30 koşu | Sayaç sürüklenmesi yok |
| S7 | arıza: 429 | Yeniden deneme ve toparlanma |

## 3. Ölçüm muhasebesi (neden bu kadar ayrıntı)

### Ham sayaç vs yaşayan bağlantı

İptal edilen bir isteğin TCP kapanışı birkaç ms gecikir. Ham sayaç bu arada
onu "canlı" sayar:

```
ölçülen 4, sınır 2          ← ham sayaç
örneklenen en fazla = 2     ← 20 ms'lik örnekleyici
kapanmış soket = 2 / açık = 2   ← aşım anındaki döküm
```

Aşım **20 ms'den kısa** ve tamamen **kapanmış soketlerden**. Sağlayıcı kapalı
soketi iş saymaz; bu yüzden ana ölçüt **yaşayan** (`liveCount`) sayımdır.
Ham sayaç yalnızca tanılama için tutulur.

### Temiz taban çizgisi

Her senaryo `drain()` ile başlar: sunucuda hiç canlı istek kalmayana kadar
beklenir. Önceki senaryonun artığı ölçüme karışırsa "2 eski + 2 yeni = 4"
gibi yanlış alarmlar çıkar.

### Sabit `sleep` yerine gözlem

S4 öncelik senaryosu ilk sürümde `sleep(20)` ile zamanlanıyordu ve makine
hızına bağlı olarak rastgele düşüyordu — çünkü `runAgent` modele gitmeden önce
araç kaydı, çalışma alanı ve skill kataloğu hazırlığı yapıyor. Artık
`modelGate.snapshot().mainWaiting === true` **gözlemlenene** kadar beklenir.

## 4. Bulunan gerçek ürün kusuru

Ölçüm gürültüsünden ayrıştırıldıktan sonra kalan tek gerçek kusur:

**İptal edilen isteğin slotu anında bırakılıyordu.**

- İstemcide `fetch` anında reddediliyor → slot serbest
- Sağlayıcıda soket birkaç ms sonra kapanıyor → hâlâ meşgul
- Arada kapı yeni istek açıyor → sağlayıcı kısa süreliğine sınır üstü

**Düzeltme:** `EVREN_ABORT_GRACE_MS` (varsayılan 250 ms). Slot iptal sonrası bu
süre tutulur. Gerçek sağlayıcılar da iptal edilen isteği hemen düşürmez.

## 5. Kanıt

| Ölçüm | Değer |
|---|---|
| Düzeltme öncesi | 3 tekrarın **3'ü de** düştü |
| Düzeltme sonrası | 5 tekrarın **5'i geçti** (31/31 kontrol) |

Tek koşu kanıt değildir; bu yüzden tekrar sayısı ölçümün parçasıdır.

## 6. Kurulu uygulama üzerinde canlı sınama

Kaynak testleri derlenmiş kodu sınar. Kullanıcının gerçekten kurduğu uygulamayı
sınamak için `scripts/installed-live-turn.mjs` CDP ile arayüzü sürer.

Ayarlar: `EVREN_MODEL_CONCURRENCY=1`, gerçek sağlayıcı.

| Ölçüm | Sonuç |
|---|---|
| Tur | 296 sn · `assistant.completed` |
| Retry / 429 | 0 / 0 |
| Araç | 9 çağrı, 0 başarısız |
| Alt ajan | 2 × `explore` (68 sn, 103 sn), 2'şer okuma |
| **Bindirme** | **1** — tam sırayla: 0.0→67.6, 67.7→170.8 |

### Bu sınamada bulunan iki kusur (sınamanın kendisinde)

1. **Gönder tıklaması işlemedi.** React sentetik click'i yuttu; tur hiç
   başlamadı ama betik "gönderdim" sandı. Düzeltme: gerçek Enter tuşu +
   ekranda kullanıcı balonu doğrulaması.
2. **"Çalışıyor mu" yanlış kaynaktan okundu.** Düğme `title`'ı eşleşmedi ve
   betik turu 20 sn'de bitmiş saydı. Düzeltme: uygulamanın kendi
   `session-events.jsonl` günlüğü (`assistant.started/completed/failed`).
3. **Okuma sayacı şişti.** Her yoklamada tüm geçmiş yeniden sayıldı: "801
   okuma" gösterdi, gerçek sayı **2**. Düzeltme: sayaç sıfırlama + günlükten
   bağımsız gerçek sayım.

Üçü de aynı sınıf: **ölçüm aracı, ölçtüğünü sandığı şeyi ölçmüyordu.**

## 7. Sınırlar

- Yük sınaması yerel sahte sunucu kullanır; gerçek sağlayıcı kotası ayrı
  değişkendir (0.4.25 yumuşak kapanışı onu karşılar).
- `EVREN_MODEL_CONCURRENCY=1` üretim için önerilmez.
- CDP sınaması arayüz seçicilerine bağlıdır; büyük UI değişikliklerinde
  güncellenmelidir.
- Soak 30 koşu ile sınırlıdır (dakikalar); saatlik dayanıklılık ayrı bir iştir.
