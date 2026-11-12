# 0.4.8 Beta — alt ajanlar boş sonuç döndürüyordu

0.4.7 alt ajanı **tetikledi** (plc_proje koşunuzda 4 paralel `explore`
başladı) ama sonuçlar boştu. Bu sürüm o kusuru kapatıyor.

## Canlı kanıt: 4 ajan, 4 boş sonuç

Sizin plc_proje koşunuzda:

```
11:32:55  spawn_agent  →  firmware (ESP32)
11:32:55  spawn_agent  →  mobil / master / paylasim (Flutter)
11:32:55  spawn_agent  →  bulut / supabase / crm (backend)
11:32:55  spawn_agent  →  kök doküman + tooling
```

Model işi **mimari katman** bazında böldü — tam istediğimiz davranış. Ama
`subagent-tasks.json` şunu gösterdi:

| Ajan | Süre | Sonuç |
|---|---|---|
| firmware | 5 dk 46 sn | `"Alt ajan adım limitine ulaştı.\n\n"` ← **boş** |
| mobil | 5 dk 03 sn | `"…\n\nI'll start by mapping the workspace…"` ← cümle ortası |
| bulut | 3 dk 35 sn | **boş** |
| doküman | 4 dk 17 sn | **boş** |

**Dördü de `MAX_STEPS = 10`'a takıldı.** Ajan tüm adımlarını araç çağrısına
harcadı, hiç metin üretmedi. Ana ajan dört boş sonuç aldı — yani alt ajanlar
tamamen boşa gitti (21 dakika, 4 ajan, sıfır bilgi).

Ayrıca `task_wait` 240 sn'de zaman aşımına uğradı (ajanlar 5-6 dk sürdü).

## Dört düzeltme

**1. Limit dolunca metin zorunlu sentez turu**

Ana döngüdeki `finalizeRun` ile aynı desen (`finalizeSubagent`):

- Araç tanımları **dolu** gönderilir + `tool_choice: 'none'`
  (0.4.4 dersi: boş `tools` dizisi sağlayıcıda hata verir)
- Modele: "Yeni araç çağırma. Şimdiye kadar topladığın bulguları dosya:satır
  referanslarıyla rapor olarak YAZ."
- Eski `"adım limitine ulaştı"` + boş metin dönüşü **kaldırıldı**

**2. Limitler gerçekçi**

| | Önce | Sonra |
|---|---|---|
| `MAX_STEPS` | 10 | **20** |
| `MAX_TOOL_CALLS` | 20 | **30** |

Gerekçe: 16 dosya okuyan bir ajan 10 adıma sığmıyor. Anthropic: basit bilgi
toplama 3–10 araç çağrısı, karşılaştırma 10–15; içerik okuma + sentez için
20/30 gerçekçi.

**3. Verimlilik kuralları (asıl kazanç)**

Alt ajan talimatına eklendi:

- **Aynı adımda birden çok `read_file`** — paralel araç çağrısı
- Önce `grep`/`glob` ile daralt, sonra oku
- 5 adım içinde metin yazmaya başla
- Rapor yazarken araç çağırma

**Ölçülen etki:** 30 dosyalık gerçek model testi **33 saniyede** bitti
(önce 5–6 dakika). Bu hem maliyeti hem `task_wait` zaman aşımını çözdü.

**4. Yumuşak son tarih (210 sn)**

Ana ajan çoğunlukla `task_wait` ile 240 sn bekler. Alt ajan bu süreyi aşarsa
ana ajan boşa bekler. Artık 210 sn'yi geçen ajan yeni araç çağırmayı bırakıp
elindekini yazar.

Ayrıca alt ajana `progressGuard` eklendi: 4 adım metinsiz geçerse "bulguları
raporla" yönlendirmesi alır.

## Doğrulama

**Gerçek model, doğrudan alt ajan testi** (`agent-live-subagent-test`):

```
süre: 33 sn · sonuç: 1742 karakter · anılan dosya: 30/30
katman sınıflandırması: doğru
"## Sonuç: moduller/ .ts dosyaları (30/30 okundu)"
"### Kimlik doğrulama katmanı (10 dosya) — birim0.ts:3 islem0 · …"
```

Eski hata metni yok, sonuç dolu ve gerçek bulgular içeriyor.

**Sentetik test** (`agent-subagent-limit-result-test`, 9 kontrol): model 25
adım boyunca araç çağırır, metin yazmaz → sentez turu atılır, sonuç dolu döner.

Toplam: **56 paket / 1294 kontrol** (önceki: 55/1285). typecheck ✓ build ✓ e2e ✓

## Yan gözlem: model artık daha akıllı strateji seçiyor

75 dosyalık canlı testte model bu kez **hiç alt ajan kullanmadı** ve
`repo_map` + `grep` ile kestirme buldu:

```
list_files 1 · repo_map 1 · read_file 9 · grep 4 · 108 sn
tüm sırlar bulundu (3/3 katman)
```

Bu **doğru** davranış: grep'le bulunabilen bir şeyi 75 dosya okuyarak aramak
israftır. Devretme bir zorunluluk değil, seçenek olmalı — mimarinin hedefi bu.

## Sıradaki

Artık şu zincir kanıtlanmış durumda:

```
keşif ipucu → alt ajan tetikleme → dolu sonuç → ana ajanda sentez
```

Bir sonraki adım **triage** (4. aşama): hangi sorgunun hangi moda düşeceğine
karar vermek. Bunun için gerçek iş yükünüzde `spawn_agent` kullanım oranını ve
alt ajan sonuçlarının nihai cevaba katkısını ölçmemiz gerekiyor.

Çoklu Evren entegrasyonu hâlâ sizin belirlediğiniz sırada bekliyor.
