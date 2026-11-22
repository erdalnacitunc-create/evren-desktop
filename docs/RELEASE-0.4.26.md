# 0.4.26 Beta — yük/kaos sınaması ve iptal grace süresi

Bu sürüm bir **ölçüm** sürümüdür: 0.4.25'in eşzamanlılık kapısı yük altında
sınandı, iki kusur bulundu, ikisi de düzeltildi.

## Yöntem (araştırmaya dayalı)

Üç kaynak ilkeyi belirledi:

| Kaynak | İlke | Burada nasıl uygulandı |
|---|---|---|
| Chaos Engineering (principlesofchaos.org) | "Steady state" **sistemin dışında** ölçülür | Eşzamanlılık, kapının kendi sayacıyla değil, **HTTP sunucusunda** sayıldı |
| Chaos Engineering | Hipotezi **çürütmeye** çalış | "≤ N" yetmez, **N'e ulaşıldığı** da kanıtlandı |
| k6 stress testi | smoke → average → stress → soak sırası | S1…S7 senaryoları bu sırayla |

Ek olarak iki kural:

- **Yalnızca ≤ N kontrolü yanıltıcıdır.** Eşzamanlılığı 1'e düşüren bir hata
  "sınırı aşmadı" diye geçerdi. Bu yüzden hem `≤ N` hem `≥ N` aranır.
- **Açlık ve sızıntı ayrı ölçülür.** Başlatılan her ajan sunucuya ulaşmalı;
  bitişte aktif slot ve kuyruk sıfır olmalı.

## Senaryolar (`scripts/model-gate-stress-test.ts`)

| # | Senaryo | Amaç |
|---|---|---|
| S1 | smoke (1 ajan) | Temel akış |
| S2 | ortalama (3 ajan, sınır 2) | Paralellik gerçekten kullanılıyor mu |
| S3 | **stress** (10 ajan, sınırın 5 katı) | Sınır aşılıyor mu, ajan aç kalıyor mu |
| S4 | öncelik (ana ajan) | Ana ajan alt ajanlara göre öne geçiyor mu |
| S5 | **kaos**: 6 ajan, 3'ü uçuşta iptal | İptal slot sızdırıyor mu, kilitlenme oluyor mu |
| S6 | **soak**: 5 dalga × 6 = 30 koşu | Sayaç sürüklenmesi, sızıntı |
| S7 | **arıza**: sağlayıcı 429 | Yeniden deneme ve toparlanma |

## Bulunan kusurlar

### 1. Ölçüm aracım da yanlıştı (iki kez)

Bu, "başarısızlığı görünmez kılma" sınıfının yeni bir örneğiydi:

| Kusur | Belirti | Düzeltme |
|---|---|---|
| İptal edilen soket "canlı" sayıldı | "ölçülen 4, sınır 2" — oysa 20 ms'lik örnekleyici hep 2 gördü | Soket kapanışı sayacı düşürür; ana ölçüt **yaşayan** bağlantı |
| Her yoklamada tüm olaylar yeniden sayıldı | Canlı izlemede "801 okuma" — gerçek sayı **2** | Sayaçlar her turda sıfırlanır; gerçek sayı günlükten ayrıca doğrulanır |
| Senaryolar kirli tabanla başladı | Önceki senaryonun isteği hâlâ canlıyken ölçüm | `drain()`: hiç canlı istek kalmayana kadar bekle |
| S4 sabit `sleep` ile zamanlandı | Makine hızına bağlı rastgele düşüş | `mainWaiting === true` **gözlemlenene** kadar bekle |

### 2. Gerçek ürün kusuru: iptal edilen isteğin slotu erken bırakılıyordu

Bu tek gerçek ürün hatasıydı ve ölçüm gürültüsünden **ayrıştırılarak**
kanıtlandı:

```
kapanmış soket=2 / açık=2   (aşım anında)
örneklenen en fazla = 2     (20 ms'lik örnekleyici hiç 2'yi geçmedi)
```

İstemci iptal ettiğinde `fetch` **anında** reddediliyordu ama sağlayıcı
tarafında soketin kapanması birkaç ms gecikiyordu. O aralıkta kapı yeni istek
açıyor, sağlayıcı kısa süreliğine sınırın üstünde istek görüyordu.

**Düzeltme:** `withModelSlot` iptal durumunda slotu
`EVREN_ABORT_GRACE_MS` (varsayılan **250 ms**) kadar tutar. Gerçek sağlayıcılar
da iptal edilen isteği hemen düşürmez; bu, kapıyı sağlayıcının davranışına
hizalar. Bedeli: iptal sonrası en fazla 250 ms eksik kapasite.

## Doğrulama

| Koşum | Sonuç |
|---|---|
| Yük sınaması, 5 tekrar | **5/5 geçti**, 31/31 kontrol |
| Tam paket | **87 paket · 2081 kontrol** |

Tek koşu kanıt değildir: düzeltme öncesi 3 tekrarın **3'ü de** düşüyordu;
düzeltme sonrası 5 tekrarın **5'i** geçti.

## Kurulu uygulama üzerinde canlı sınama

`scripts/installed-live-turn.mjs` — CDP ile **kurulu** uygulamayı sürer
(yayınlanan artefaktın test edilen kodla aynı olduğunu kanıtlar).

Ayarlar: `EVREN_MODEL_CONCURRENCY=1` (en sıkı), gerçek sağlayıcı.

| Ölçüm | Sonuç |
|---|---|
| Süre | 296 sn |
| Tur sonu | `assistant.completed` |
| Retry | **0** |
| 429 / doygunluk | **0** |
| Araç çağrısı | 9 (read_file 4, spawn_agent 2, glob 2, grep 1) |
| Başarısız araç | **0** |
| Alt ajanlar | 2 `explore`, 68 sn ve 103 sn, 2'şer başarılı okuma |
| **Bindirme** | **1** — ikisi tam sırayla koştu (0.0→67.6, 67.7→170.8) |

Bindirme=1, kapının **kurulu uygulamada** gerçekten serileştirme yaptığının
kanıtı. Yanıt ayrıca dürüsttü: "bu test dosyalarını okumadım, çalıştıklarını
doğrulamıyorum".

## Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `EVREN_MODEL_CONCURRENCY` | `2` | Uçuştaki en fazla model isteği (1–8) |
| `EVREN_ABORT_GRACE_MS` | `250` | İptal sonrası slotun tutulma süresi (0–5000) |

## Dosyalar

- `src/main/agent/modelGate.ts` — `abortGraceMs`, iptal farkındalıklı `withModelSlot`
- `scripts/model-gate-stress-test.ts` (yeni) — 7 senaryo, bağımsız ölçüm
- `scripts/gate-abort-diagnose*.ts` (yeni) — iptal/ölçüm ayrımı tanılaması
- `scripts/installed-live-turn.mjs` (yeni) — kurulu uygulamada CDP canlı sınama
- `docs/STRESS-VERIFICATION.md` (yeni) — yöntem ve bulgular

## Sınırlar

- Yük sınaması **yerel sahte sunucu** kullanır; gerçek sağlayıcı kotası ayrı
  bir değişkendir (0.4.25'teki yumuşak kapanış onu karşılar).
- `EVREN_MODEL_CONCURRENCY=1` üretim için önerilmez; testte sınırı zorlamak
  için kullanıldı.
- CDP sınaması bir kullanıcı arayüzü otomasyonudur; arayüz büyük ölçüde
  değişirse seçiciler güncellenmelidir.
