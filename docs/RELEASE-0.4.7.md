# 0.4.7 Beta — alt ajanlar fiilen tetikleniyor

0.4.6'da altyapı hazırdı ama model alt ajan **kullanmıyordu** (sizin iki
sınamanızda da 0 tetikleme). Bu sürüm nedeni bulup düzeltiyor.

## Teşhis: altyapı sağlamdı, tetikleyici yoktu

0.4.6 paketinde doğruladım:

```
araç sayısı: 28 · spawn_agent: true · tool_choice: auto
sistem istemi: delegation bölümü ✅ · "en fazla 6" ✅
```

Yani kod doğruydu. İki gerçek sınamanızda modelin düşünme metninde "alt ajan",
"spawn", "paralel" **hiç geçmedi** — düşünüp vazgeçmedi, hiç aklına gelmedi.

### Asıl kusur: model listeledi, okumadı

"wifi klima klasörü … program yapısını incele" sınamasında model 4
`Get-ChildItem -Recurse` ile 40+ dosyayı **listeledi**, mimariyi dosya adı ve
boyutundan çıkardı ve raporunda **4 kez** şunu yazdı:

> "Bu dosyaların içeriği okunmadı — doğrulanamadı."

Tam o noktada paralel `explore` alt ajanları gerçek değer üretirdi. Eski kural
"çok dosyalı keşif → 2-4 explore" diyordu; model bunu "dosyaları listele"
diye okudu.

## Düzeltme 1: kuralı keskinleştir (listeleme ≠ okuma)

| Durum | Davranış |
|---|---|
| Dosya **adı/boyutu** yeterli (yapı, dil, modül sayısı) | doğrudan `list_files`/`glob`, **devretme** |
| **İçerik** doğrulaması + 5'ten fazla dosya (sır, protokol, bağımlılık, "tüm çağrı yerleri") | 2-4 `explore` **paralel** |

## Düzeltme 2: deterministik keşif ipucu

Modelin aklına gelmesini beklemek yetmiyor. Döngü artık durumu **gözlemliyor**
(`src/main/agent/explorationHint.ts`):

- Araç sonuçlarındaki dosya yollarını sayar
- `list_files`/`glob`/`grep` ve `Get-ChildItem` çıktısı = **listeleme**
- `read_file`/`repo_map`/`code_search` ve `Get-Content` = **okuma**
- ≥10 dosya listelenip okunan oran %20'nin altındaysa modele **tek seferlik**
  hatırlatma gider

`progressGuard` ile aynı desen: **hatırlatma, zorlama değil**. Araç
engellenmez; görev yalnızca yapı sorusuysa model ipucunu yok sayabilir
(metinde bu açıkça yazıyor).

Log kanıtı (gerçek koşu):

```
(agent/loop) Keşif ipucu: 16 dosya listelendi, 0 okundu — alt ajan önerildi
```

## Canlı doğrulama: gerçek model, gerçek görev

24 dosyalık yapay bir ESP firmware projesi + gömülü sırlar üretildi; görev
**içerik** okumayı gerektiriyordu ("gömülü sırları dosya:satır ile listele").

**Sonuç: 4 paralel `explore` alt ajanı çalıştı.**

```
süre: 190 sn
araç dağılımı: glob 1 · spawn_agent 4 · task_wait 4 · read_file 1
subagent-task olayı: 8 (4 başladı + 4 bitti)
sır bulundu: EVET
```

Modelin ürettiği görevler — her biri **farklı dosya grubu**, kendi kendine
yeten talimat:

```
explore: "firmware/ag.h, api.h, ayarlar.h, durum_coz.h dosyalarını TAM içeriklerini oku…"
explore: "firmware/haier_kare.h, kok_sertifika.h, kumanda.h, led.h …"
explore: "firmware/main.h, mqtt.h, mqtt_tani.h, ota.h …"
explore: "firmware/sensor.h, tls_olc.h, web.h, zamanlayici.h …"
```

Bu, mimarinin hedeflediği davranışın birebir kendisi: **işi böl, paralel oku,
sonuçları topla, sentezle.**

## Test kapsamı

| Paket | Kontrol | Kapsam |
|---|---|---|
| `agent-exploration-hint-test` | 48 | Yol sayımı, listeleme/okuma ayrımı, oran eşiği, ipucu metni |
| `agent-spawn-trigger-test` | 13 | Uçtan uca: listele → ipucu → spawn → sonuç; ve doğrudan spawn |
| `agent-live-spawn-test` | 2 | Gerçek model, gerçek proje, gerçek sırlar (elle çalıştırılır) |

Toplam: **55 paket / 1285 kontrol** (önceki: 53/1224). typecheck ✓ build ✓ e2e ✓

`agent-live-spawn-test` bilinçli olarak `test:unit` içinde **değil**: gerçek
sağlayıcıya istek atar ve token harcar.

```bash
node scripts/run-unit.cjs scripts/agent-live-spawn-test.ts
```

## Yan bulgu: test altyapısında şifre çözme tuzağı

Canlı test ilk denemede "API anahtarı yok" dedi. Neden: Chromium, `safeStorage`
anahtarını `Local State` dosyasında DPAPI ile sarılı tutuyor. Yalnızca
`credentials.bin` kopyalamak yetmiyor; `Local State` de gerekli. Bu, test
altyapısı için belgelendi.

## Sıradaki

Artık ölçülebilir bir davranış var. Bir sonraki adım **gerçek iş
yükünüzde** bunun ne sıklıkta ve ne kadar faydalı olduğunu görmek:

- `session-events.jsonl` içinde `spawn_agent` sayısı
- Alt ajan sonuçlarının nihai cevaba katkısı
- Süre/token maliyeti (alt ajan ~4× token)

Bu veri gelince 4. aşamaya (triage: hangi sorgu hangi mod) geçebiliriz.
Çoklu Evren entegrasyonu hâlâ sizin belirlediğiniz sırada bekliyor.
