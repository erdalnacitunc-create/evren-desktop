# 0.4.25 Beta — eşzamanlılık kapısı + dış okuma kökleri

Bu sürüm, **0.4.24 canlı koşusunun** ortaya çıkardığı üç kusuru kapatır.
Doğrulama kapısı (0.4.24) o turda hiç devreye girmedi; tur daha erken bir
katmanda düştü.

## Kanıt: 0.4.24 canlı koşusu

| | |
|---|---|
| Sorgu | "masaüstünde bulunan `evren-desktop` projesini incele" |
| Çalışma alanı | boş geçici dizin |
| Süre | 10 dk 42 sn → ❌ `assistant.failed` |
| Neden | "hesabınız bu modelde en fazla **2 eşzamanlı istek** açabilir" |
| Bizim gönderdiğimiz | ana ajan + 2 `explore` = **3** |
| Alt ajanlar | ikisi de hiçbir dosya okuyamadı (370 sn), ama **uydurmadı** |

## 1. Model istek kapısı

`subagentConcurrency = 2` yalnızca alt ajanları sayıyordu; ana ajanın kendi
isteği hesaba katılmıyordu. Artık süreç genelinde tek sayaç var:

- Varsayılan **2** uçuştaki istek (`EVREN_MODEL_CONCURRENCY` ile 1–8).
- Ana ajan + alt ajanlar + sentez + hakem aynı kapıyı paylaşır.
- **Ana ajan önceliği**: ana ajan sırada beklerken yeni alt ajan başlamaz.
- Slot yalnızca istek sürerken tutulur → kilitlenme yok.
- İptal, kuyruktayken çalışır; slot sızdırmaz.

## 2. Dış okuma kökleri (salt-okunur)

Kullanıcının mesajında **açıkça yazdığı** mutlak yollar okunabilir hâle gelir:

- En fazla 5 kök, yalnızca var olan yollar; dosya verilirse üst dizini.
- `read_file`/`list_files`/`glob`/`grep` mutlak yolla çalışır; `glob`/`grep`
  sonuçları mutlak yol döndürür.
- **Yazma açılmaz**: `write_file`/`edit_file`/`patch`/`run_command` hâlâ yalnızca
  çalışma alanında.
- Symlink kök dışına çıkarsa reddedilir; kökler istek bitince kaybolur.
- Model kendi kökünü ekleyemez — yalnızca kullanıcı metni kaynak.

## 3. Doygunlukta turu düşürme

`RateLimit`/`ProviderInternal` artık kod hatası değil **kapasite** durumu:
eldeki içerik korunur, nedeni ve çözümü söyleyen kısa mesaj yazılır, tur
`provider-busy` ile normal kapanır. 10 dakikalık sessiz kayıp biter.

## 4. İstem dürüstlüğü

Salt-okunur ajana "çalışma alanı dışı" notu artık **gerçek yeteneğe** göre
yazılır. Kök yoksa ajan araç denemesi yapmaz; hemen `doğrulanamadı` döner.

## Kanıt

| Test | Sonuç |
|---|---|
| `model-gate-test` | 18/18 |
| `model-concurrency-e2e-test` | 4/4 (`istek=3 · en fazla eşzamanlı=2`) |
| `read-roots-test` | 13/13 |
| `read-roots-e2e-test` | 12/12 |
| `model-concurrency-live-test` (**gerçek model**) | 5/5 |

Gerçek sağlayıcıyla: **104 sn · `done=stop` · hata=0 · kapı=2**. İki `explore`
ajanı boş geçici çalışma alanına rağmen dış projedeki dosyaları okudu.
0.4.24'te aynı senaryo 10 dk 42 sn sonra `assistant.failed` ile düşüyordu.

## Dosyalar

- `src/main/agent/modelGate.ts` (yeni), `src/main/agent/readRoots.ts` (yeni)
- `src/main/workspace.ts` — `runWithReadRoots`, `resolveReadTarget`; okuma
  araçları bu kapsamı kullanır (yazma yolları değişmedi)
- `src/main/agent/loop.ts` — kapı kablolaması, okuma kökleri, dürüst ipucu,
  doygunlukta yumuşak kapanış (`providerBusyNote`)
- `src/main/agent/subagent.ts` — kapı kablolaması, yeteneğe göre dış not
- 4 yeni test paketi, `docs/MODEL-CONCURRENCY.md`

## Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `EVREN_MODEL_CONCURRENCY` | `2` | Uçuştaki en fazla model isteği |

## Sınırlar

- Kök çıkarımı sözdizimseldir: mesajda yazılmayan yol açılmaz.
- Okuma kökü yazma açmaz.
- Ana ajan önceliği preemption değildir; biri bitene kadar bekler (20–60 sn).
- Sağlayıcı kotası başka istemciden de dolabilir; o durumda 3. madde devreye girer.
