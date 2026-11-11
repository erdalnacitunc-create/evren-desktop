# Hibrit Ajan Mimarisi — Çoklu Evren + Alt Ajanlar

> Durum: **tasarım şablonu** (v1). Çalışma zamanına henüz bağlanmadı; kararlar
> ve sınırlar burada sabitlenir, uygulama aşamalı yapılır.
> İlgili kod: `src/shared/agentTopology.ts` · `scripts/agent-topology-test.ts`

## 0. Kısa cevap

İki yapı **rakip değil, farklı eksenlerde** çalışır:

| Yapı | Sağladığı | Eksen |
|---|---|---|
| Çoklu Evren | **Model çeşitliliği** — farklı modeller aynı soruya bağımsız cevap verir | Yatay (model) |
| Alt ajan | **Bağlam izolasyonu** — keşif/araştırma ana bağlamı kirletmez | Dikey (bağlam) |

Hibrit yapının tek cümlesi: **"Keşif paralel, yazma tek sıra."**

- Keşif, inceleme, doğrulama → paralel (alt ajanlar + gerekirse çoklu model)
- Dosya yazma, komut çalıştırma, ayar değiştirme → **tek** yazıcı (lider ajan)

Bu ayrım keyfî değil; iki bağımsız kaynak aynı sonuca varıyor (§1).

## 1. Kanıt: endüstri ne diyor

### 1.1 Paralelin kazandığı yer

Anthropic'in üretimdeki Research sistemi (orchestrator–worker):

- Çoklu ajan, tek ajana göre iç değerlendirmede **%90,2** daha iyi
- Performans varyansının **%80'i** yalnızca token kullanımıyla açıklanıyor;
  yani çoklu ajan "daha çok düşünme kapasitesi" satın alıyor
- Maliyet: ajan **4×**, çoklu ajan **15×** token
- En iyi olduğu iş: **genişlik öncelikli** (breadth-first) araştırma
- Açık uyarı: *"çoğu kodlama görevi, araştırmaya göre çok daha az
  paralelleştirilebilir alt görev içerir ve LLM ajanları henüz gerçek
  zamanlı koordinasyon/devretmede iyi değil"*

### 1.2 Paralelin kırıldığı yer

Cognition'ın "Don't Build Multi-Agents" yazısı, tam da bizim senaryomuzu
(coding agent) anlatıyor:

- Paralel alt ajanlar **örtük kararlar** alır; bu kararlar çelişirse
  birleştirme aşaması kurtarılamaz (Flappy Bird örneği: biri Mario
  arkaplanı, diğeri başka stil kuş)
- Claude Code bu yüzden alt ajanı **soru cevaplamakla** sınırlar, **kod
  yazdırmaz** ve ana ajanla **paralel çalıştırmaz**
- Tek iş parçacıklı (single-threaded) ajan varsayılan olarak daha güvenilir

### 1.3 Sentez

> **Okuma paraleldir, yazma seridir.**
> Model çeşitliliği *öneri* üretir; *eylem* tek elden çıkar.

## 2. Neden "her alt ajana çoklu evren" yanlış

Naif hibrit şudur:

```
Sorgu → 4 alt ajan × 4 model = 16 paralel koşu → sentez
```

Bu üç nedenle çöker:

1. **Maliyet patlaması** — 15× çoklu ajan × 4 = ~60× sohbet maliyeti.
2. **Çelişen kararlar** — 16 bağımsız bağlam, 16 farklı varsayım; sentez
   ajanı hakem değil, çöp toplayıcı olur.
3. **Gürültü** — aynı soruya 16 cevap, çeşitlilik değil tekrar üretir;
   bilgi eklemez, yalnızca seçim maliyeti ekler.

Doğru ilişki **çarpım değil, sıralı aşama**:

```
keşif (paralel, tek model ailesi)
   ↓ paylaşılan brifing (tek gerçek kaynak)
aday üretimi (paralel, farklı modeller, SALT-OKUNUR)
   ↓ rubrikle sentez
eylem (tek yazıcı)
```

Çeşitliliğin değerli olduğu yer **karar** anıdır (hangi yaklaşım, hangi
plan, hangi kök neden); **keşif** anında çeşitlilik değil kapsama gerekir.

## 3. Hedef mimari

```
                       ┌──────────────────────────────┐
   Kullanıcı sorusu →  │ 0. TRIAGE (ucuz, deterministik)│
                       └──────────────┬───────────────┘
                                      │ plan: mod + bütçe
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
   direct (1 koşu)             recon (paralel okuma)          multiverse (paralel model)
                                      │                             │
                                      └──────────┬──────────────────┘
                                                 ▼
                                   ┌──────────────────────────┐
                                   │ 2. SENTEZ / HAKEM        │
                                   │ (rubrik, çapraz kontrol) │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 3. EYLEM (tek yazıcı)    │
                                   │ yazma · komut · doğrulama│
                                   └──────────────────────────┘
```

### 3.1 Aşama 0 — Triage

Girdi: kullanıcı metni, çalışma alanı durumu, kullanıcı seçimleri
(Çoklu Evren açık/kapalı), kalan bütçe.

Çıktı: `TopologyPlan` (bkz. `src/shared/agentTopology.ts`).

Kurallar:

- **Kullanıcı seçimi her zaman kazanır.** Çoklu Evren'i kullanıcı açtıysa
  triage onu kapatmaz; yalnızca alt ajan sayısını kısar.
- Triage **LLM çağrısı yapmaz** — sezgisel sınıflandırma. Ekstra bir model
  çağrısı, kazandırdığından fazlasını harcar.
- Belirsizlik varsa **daha ucuz** moda düşer (varsayılan `direct`).

### 3.2 Aşama 1a — Recon (alt ajanlar)

| Özellik | Değer |
|---|---|
| Araç yetkisi | **salt-okunur** (`explore`, `review`) |
| Eşzamanlılık | en fazla **4** |
| İstek başına toplam | en fazla **6** |
| Derinlik | **1** (alt ajan alt ajan açamaz) |
| Adım | 10 · araç çağrısı 20 (mevcut) |
| Çıktı | 12 000 karaktere kırpılmış özet |
| Model | lider modelin **aynısı** (ucuz model isteğe bağlı, §6) |

**Neden salt-okunur?** Cognition'ın 2. ilkesi: eylemler örtük kararlar taşır.
Yazan alt ajan, liderin görmediği kararlar alır. Okuma öyle değil — okuma
sonucu bir *gözlem*dir, çelişse bile birleştirilebilir.

**Neden 4?** Anthropic 3–5 paralel alt ajan kullanıyor. 4, tipik 8 çekirdekli
bir masaüstünde sağlayıcı hız sınırına takılmadan çalışan üst değer.

**Çıktı neden dosyaya?** Anthropic'in "game of telephone" notu: büyük çıktıyı
liderin bağlamından geçirmek hem token yakar hem bilgi kaybettirir. Alt ajan
bulguyu `artifacts` alanına yazar, lidere yalnızca **referans + 500 karakter
özet** döner.

### 3.3 Aşama 1b — Çoklu Evren (aday üretimi)

| Özellik | Değer |
|---|---|
| Üye model | en fazla **3** (+1 sentez) |
| Eşzamanlılık | 3 (mevcut havuz) |
| Yetki | **salt-okunur** — yalnızca *öneri* üretir |
| Girdi | aynı görev + **aynı recon brifingi** |
| Çıktı | plan / yama önerisi / kök neden analizi (metin) |

Kritik kural: **tüm üyeler aynı brifingi alır.** Farklı brifing = farklı
varsayım = Cognition'ın 1. ilkesinin ihlali.

İkinci kritik kural: **üyeler yazmaz.** Yazsaydı 3 farklı dosya sürümü
birleştirilemezdi. Üyeler *ne yapılacağını* söyler, *yapan* tektir.

### 3.4 Aşama 2 — Sentez / Hakem

- Girdi: recon bulguları + N aday
- Rubrik (sıralı): doğruluk → kapsama → kanıt kalitesi → maliyet/risk
- Çıktı: seçilen yaklaşım + gerekçe + birleştirilmiş plan
- **Uzlaşmazlık kaydı**: adaylar çelişiyorsa bu *bilgi*dir; sentez çelişkiyi
  gizlemez, kullanıcıya "X dedi, Y dedi, şu kanıtla X seçildi" der.

Sentez tek model çağrısıdır (Anthropic: tek LLM hakem, çoklu hakemden daha
tutarlı).

### 3.5 Aşama 3 — Eylem

- Tek yazıcı: lider ajan
- Araçlar: `write_file`, `edit_file`, `run_command`, `git`
- Her yazma sonrası doğrulama (`run_checks`) — mevcut davranış korunur
- İlerlemesiz döngü koruması (0.4.2) burada da geçerli

## 4. Modlar ve bütçeler

`planTopology()` bu tabloyu üretir:

| Mod | Ne zaman | Alt ajan | Üye model | Model çağrısı (tavan) | Göreli maliyet |
|---|---|---|---|---|---|
| `direct` | tek dosya, net komut, kısa soru | 0 | 0 | adım sayısı | 1× |
| `recon` | çok dosyalı keşif, "nerede/nasıl çalışıyor" | 2–4 | 0 | 1 + 4 | ~5× |
| `multiverse` | belirsiz/riskli karar, "hangisi daha iyi" | 0 | 2–3 | 4 | ~15× |
| `hybrid` | karmaşık **ve** riskli: mimari seçim, kök neden | 2–3 | 2–3 | 1 + 3 + 3 + 1 = 8 | ~25× |

Sert tavanlar (moddan bağımsız):

```ts
MAX_CONCURRENT_SUBAGENTS = 4
MAX_SUBAGENTS_PER_REQUEST = 6
MAX_MULTIVERSE_MEMBERS = 3
MAX_TOTAL_MODEL_CALLS = 12
MAX_SUBAGENT_DEPTH = 1
SUBAGENT_MAX_STEPS = 10
SUBAGENT_MAX_TOOL_CALLS = 20
```

**Bütçe tükenirse** fan-out durur; elde olanla sentez yapılır ve kullanıcıya
"bütçe nedeniyle 2/4 keşif tamamlandı" denir. Sessizce uzatmak yok.

## 5. Skill mimarisi

### 5.1 İki katman

Bugün `loadEnabledSkills()` tüm `SKILL.md` gövdelerini yüklüyor. Ölçeklenmez:
40 skill × 3 000 token = 120 000 token, daha iş başlamadan.

**Katman 1 — Katalog (her zaman bağlamda):**
yalnızca `name` + `description` + `whenToUse` (≤ 120 karakter).

**Katman 2 — Gövde (istek üzerine):**
`skill` aracı çağrılınca yüklenir.

Claude Code de aynı sınırı yaşıyor: alt ajan açıklamaları toplamı 15 000
token'ı aşınca uyarı veriyor. Biz daha erken keselim:

```ts
SKILL_CATALOG_MAX_TOKENS = 6000      // ~40 skill
SKILLS_INJECTED_PER_AGENT = 3        // retrieval ile seçilir
SKILL_BODY_MAX_TOKENS = 4000
```

### 5.2 Skill yönlendirme (router)

Alt ajana **tüm** skill'ler verilmez. Görev metni + çalışma alanı ipuçlarıyla
en fazla 3 skill seçilir (embedding + anahtar kelime, mevcut hafıza
altyapısındaki `retrieve` ile aynı yaklaşım).

Böylece "skill sayısı arttıkça prompt şişer" problemi ortadan kalkar.

### 5.3 Otomatik skill oluşturma — sınırlı ve onaylı

Bu, istediğiniz "kendi skill yapısını otomatik oluşturan ajan" fikrinin
güvenli hâli:

| Kural | Değer |
|---|---|
| Tetikleme | aynı iş akışı **≥ 3 kez** başarıyla tekrarlandıysa |
| Üretim | yalnızca **taslak** (`SKILL.draft.md`) |
| Konum | karantina dizini; katalogda **görünmez** |
| Onay | kullanıcı arayüzden onaylar (tek tık) |
| Aktivasyon | onaydan sonra, `enabled: true` |
| Sınır | oturum başına **1**, haftada **3** taslak |
| Yasak | yazma/komut skill'i üretemez (yalnızca `read`/`review` kategorisi) |
| Denetim | kaynak oturum kimliği + gerekçe zorunlu |

**Neden tam otomatik değil?** Skill, ajanın davranışını kalıcı değiştirir.
Zehirlenmiş bir skill (yanlış komut, eski yol) tüm oturumlara yayılır — bu,
0.4.2'de düzelttiğimiz hafıza kirliliğinin daha ağır hâli. Taslak + onay,
faydayı korurken bu riski keser.

### 5.4 Skill kalitesi

- Her skill'e `lastVerifiedAt` ve `successRate` alanı
- Başarı oranı %40'ın altına düşen skill otomatik **devre dışı** (silinmez)
- Skill gövdesi ≤ 4 000 token; aşarsa bölünmesi önerilir

## 6. Model yönlendirme (isteğe bağlı, güçlü)

Alt ajanlar liderle aynı modeli kullanmak zorunda değil:

| Rol | Model sınıfı | Gerekçe |
|---|---|---|
| Triage | deterministik | LLM gerekmez |
| Recon alt ajanı | hızlı/ucuz | kapsama önemli, derin akıl değil |
| Çoklu Evren üyesi | **farklı aileler** | çeşitlilik burada anlamlı |
| Sentez/hakem | en güçlü | karar kalitesi kritik |
| Eylem (yazıcı) | güçlü, araç yetenekli | hata maliyeti yüksek |

Çoklu Evren'in asıl değeri buradan gelir: üyeler farklı **model ailelerinden**
seçilirse gerçek çeşitlilik olur; aynı ailenin 3 sürümü çoğunlukla aynı hatayı
yapar.

## 7. Gözlemlenebilirlik

Her koşu için tek satırlık özet (mevcut `session-events.jsonl`'e eklenir):

```
topology mode=hybrid recon=3/3 members=3 calls=8 stopped=budget
```

- `recon=3/3` → planlanan/tamamlanan
- `calls` → gerçek model çağrısı
- `stopped=budget|timeout|abort|ok`

Bu olmadan "hibrit daha iyi mi" sorusu ölçülemez.

## 8. Değerlendirme (nasıl kanıtlarız)

Anthropic'in yaklaşımı: 20 gerçek sorguluk küçük set, LLM hakem + insan
incelemesi.

Bizde:

1. **20 sorguluk set** (10 kod, 5 sistem/donanım, 5 araştırma)
2. Her sorgu 4 modda çalıştırılır: `direct`, `recon`, `multiverse`, `hybrid`
3. Rubrik: doğruluk, kapsama, kanıt, süre, token
4. Kabul eşiği: `hybrid`, `direct`'e göre **doğrulukta ≥ %15** artış
   sağlamıyorsa varsayılan `recon` olur (maliyet düşük)

**Hipotez:** hibrit yalnızca "karmaşık + riskli" dilimde kazanır. Diğer
dilimlerde `direct`/`recon` daha iyi olacak. Bu yüzden triage şart.

## 9. Riskler ve koruma

| Risk | Koruma |
|---|---|
| Maliyet patlaması | mod bütçesi + `MAX_TOTAL_MODEL_CALLS=12` |
| Çelişen yazmalar | yazma yalnızca liderde |
| Bağlam şişmesi | çıktı dosyaya, lidere referans |
| Sonsuz alt ajan | derinlik 1 + istek başına 6 |
| Aynı işi tekrar eden ajanlar | görev metni benzerliği > %70 ise spawn reddi |
| Skill zehirlenmesi | taslak + onay + karantina |
| Sessiz kalite düşüşü | mod etiketi + A/B değerlendirme |
| Kullanıcı kontrolü kaybı | "Çoklu Evren" düğmesi her zaman kazanır; tek tıkla durdur |

## 10. Uygulama sırası

| Aşama | İş | Risk | Değer |
|---|---|---|---|
| **1** | Eşzamanlılık sınırı + istek başına alt ajan tavanı (bugün **sınırsız**) | düşük | güvenlik |
| **2** | Recon alt ajanlarını gerçekten devreye sok (bugün **0 kullanım**) | düşük | yüksek |
| **3** | Skill kataloğu/gövde ayrımı + router | orta | ölçek |
| **4** | `planTopology` kararını döngüye bağla (mod seçimi) | orta | maliyet |
| **5** | Çoklu Evren üyelerini salt-okunur + ortak brifinge geçir | orta | tutarlılık |
| **6** | Otomatik skill taslağı + onay akışı | yüksek | uzun vade |

Bugünkü durum: **1. ve 2. aşama yapılmadan 4–6'ya geçmek anlamsız.**
Hibrit mimarinin faydası, alt ajanlar fiilen çalışmaya başlayınca ölçülebilir.

## 11. Açık sorular

1. **Triage eşiği** — hangi sorgu `hybrid`? İlk 20 sorguluk setle kalibre
   edilmeli; şimdiki sezgisel eşikler tahmin.
2. **Üye model seçimi** — kullanıcı mı seçsin, otomatik mi? Öneri: otomatik
   (farklı ailelerden 3), kullanıcı değiştirebilsin.
3. **Recon çıktısı nereye?** Oturum artifact dizini mi, ayrı `recon/` klasörü
   mü? Öneri: oturum artifact dizini (mevcut `artifacts` altyapısı).
4. **Bütçe birimi** — token mı, model çağrısı mı? Öneri: model çağrısı
   (kullanıcı için anlaşılır, sağlayıcıdan bağımsız).
5. **Eşik öğrenmesi** — başarılı/başarısız koşulardan triage eşiği
   güncellenmeli mi? Uzun vadede evet, ama önce sabit eşikle ölçüm gerekir.
