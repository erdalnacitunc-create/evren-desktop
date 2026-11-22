# Model İstek Kapısı ve Dış Okuma Kökleri (0.4.25)

Bu sürüm, 0.4.24 canlı koşusunun (22 Kasım 2026) ortaya çıkardığı üç kusuru
kapatır. Kapı (0.4.24) bu turda **hiç devreye girmedi**; çünkü turda yazan
(`general`) alt ajan yoktu — sorun daha erken bir katmandaydı.

## 0. Kanıt: 0.4.24 canlı koşusu

| | |
|---|---|
| Sorgu | "masaüstünde bulunan `evren-desktop` projesini incele" |
| Oturum çalışma alanı | boş geçici dizin (`%TEMP%\evren-workspaces\…`) |
| Süre | 16:09:03 → 16:19:45 = **10 dk 42 sn** |
| Sonuç | ❌ `assistant.failed` — "hesabınız bu modelde en fazla **2 eşzamanlı istek** açabilir" |
| Deneme | 16 retry, 10'u son turda |
| Alt ajan | 2 `explore`, her biri ~370 sn, ikisi de **hiçbir dosya okuyamadı** |
| `verify` olayı | 0 (kapı hiç çalışmadı — yazan ajan yoktu) |

İyi haber: iki alt ajan da **uydurmadı**. "Kanıt üretilemedi, tahminle
doldurmadım" dediler ve kök nedeni doğru teşhis ettiler (boş workspace,
`run_command` yok). Yani "başarısızlığı başarı gibi raporlama" kusuru oluşmadı.

---

## 1. A — Model istek kapısı (asıl hata)

**Kusur:** `subagentConcurrency = 2` yalnızca alt ajanları sayıyordu. Ana
ajanın kendi isteği hesaba katılmıyordu → uçuşta **3** istek, sağlayıcı **2**
kabul ediyor.

**Çözüm:** `src/main/agent/modelGate.ts` — süreç genelinde tek sayaç.

| Özellik | Davranış |
|---|---|
| Varsayılan | **2** (`EVREN_MODEL_CONCURRENCY` ile 1–8) |
| Kapsam | Ana ajan + alt ajanlar + sentez + hakem |
| Öncelik | Ana ajan sırada beklerken **yeni alt ajan başlamaz** |
| Slot ömrü | Yalnızca istek sürer; araç çalışırken bırakılır (kilitlenme yok) |
| İptal | Kuyrukta beklerken `AbortSignal` ile çıkar, slot sızdırmaz |

Kablolama: `loop.ts` (ana adım + nihai sentez) ve `subagent.ts` (adım +
sentez) `withModelSlot(...)` içinden geçer. `streamWithContinuation`'ın `run`
geri çağrısı sarmalanır; böylece tek istek = tek slot.

## 2. B — Dış okuma kökleri

**Kusur:** Kullanıcı masaüstündeki projeyi sordu, çalışma alanı boş geçici
dizindi. Ana ajan `run_command` ile okuyabildi; salt-okunur alt ajanlar
**hiçbir şey** okuyamadı. Dahası istem onlara "run_command kullan" diyordu —
o araç salt-okunur ajanda hiç yok.

**Çözüm:** Kullanıcının mesajında **açıkça yazdığı** mutlak yollar salt-okunur
kök olarak açılır.

| Kural | Ayrıntı |
|---|---|
| Kaynak | Yalnızca son kullanıcı iletisindeki mutlak yollar (`readRoots.ts`) |
| Sınır | En fazla **5** kök; yalnızca **var olan** yollar |
| Dosya → kök | Dosya verilirse **üst dizini** kök olur |
| Okuma | `read_file`, `list_files`, `glob`, `grep` mutlak yolla çalışır |
| Yazma | **Etkilenmez** — `resolveInside` hâlâ çalışma alanına kilitli |
| Symlink | Hedef kökün dışına çıkarsa reddedilir |
| Kapsam | `AsyncLocalStorage`; istek bitince kökler kaybolur |
| Model | Model kendi kökünü **ekleyemez**; yalnızca kullanıcı metni |

`glob`/`grep` dış kökte **mutlak yol** döndürür ki ana ajan yolu çözebilsin.

## 3. C — Doygunlukta turu düşürme

**Kusur:** 16 retry sonunda tur tamamen düştü; kullanıcı 10 dakika sonra
yalnızca hata gördü.

**Çözüm:** `RateLimit`/`ProviderInternal` hatası artık **kapasite durumu**
olarak ele alınır: eldeki içerik korunur, nedeni ve ne yapılacağını söyleyen
kısa bir mesaj yazılır ve tur `provider-busy` nedeniyle normal kapanır.

## 4. D — İstem dürüstlüğü

Salt-okunur ajana verilen "çalışma alanı dışı" notu artık **gerçek yeteneğe**
göre yazılır:

- Kök varsa: "şu kökler salt-okunur açık, mutlak yolla oku".
- Kök yoksa: "dış okuma yok, `run_command` bu ajan türünde tanımlı değil —
  araç denemeleriyle adım harcama, hemen `doğrulanamadı` döndür".

Ana ajanın ipucu da önce `read_file`'ı önerir; `run_command` yalnızca kök
dışındaki yollar için.

---

## 5. Kanıt

| Test | Kapsam | Sonuç |
|---|---|---|
| `scripts/model-gate-test.ts` | Sayaç, öncelik, iptal, çift release | 18/18 |
| `scripts/model-concurrency-e2e-test.ts` | 3 alt ajan paralel → sunucuda en fazla 2 eşzamanlı | 4/4 |
| `scripts/read-roots-test.ts` | Yol çıkarımı, sınır, dosya→dizin | 13/13 |
| `scripts/read-roots-e2e-test.ts` | Okuma açık, kök dışı kapalı, **yazma kapalı** | 12/12 |
| `scripts/model-concurrency-live-test.ts` | **Gerçek model**: tur düşmüyor, alt ajan dış dosyayı okuyor | 5/5 |

Gerçek sağlayıcıyla koşu: **104 sn · `done=stop` · hata=0 · kapı=2**. İki
`explore` ajanı boş geçici çalışma alanına rağmen dış projedeki `ayar.ts` ve
`README.md` dosyalarını okudu (`read_file ok`). 0.4.24'te aynı senaryo 10 dk
42 sn sonra hatayla düşüyordu.

E2E ölçümü (sahte sunucu): `istek=3 · en fazla eşzamanlı=2 · kapı=2`. Yani
paralellik korunuyor ama sağlayıcı sınırı aşılmıyor.

## 6. Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `EVREN_MODEL_CONCURRENCY` | `2` | Uçuştaki en fazla model isteği (1–8) |

Sağlayıcı hesabı daha yüksek eşzamanlılık veriyorsa bu değer artırılabilir.

## 7. Sınırlar (bilinçli)

- **Kök çıkarımı sözdizimseldir.** Mesajda yazılmayan bir yol açılmaz; bu
  bilinçli. Kullanıcı projeyi çalışma alanı yaparsa kısıt tamamen kalkar.
- **Okuma kökü yazma açmaz.** `write_file`/`edit_file`/`patch`/`run_command`
  hâlâ yalnızca çalışma alanında çalışır.
- **Ana ajan önceliği preemption değildir.** İki alt ajan isteği sürerken ana
  ajan, biri bitene kadar bekler (tipik olarak 20–60 sn).
- **Sağlayıcı kotası dışarıdan dolabilir.** Kapı kendi isteklerimizi sınırlar;
  başka bir istemci aynı hesabı tüketirse C maddesi devreye girer.
