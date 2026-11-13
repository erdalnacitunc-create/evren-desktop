# 0.4.10 Beta — web araması düzeltildi, alt ajan gözlemlenebilirliği

Web sorgusuyla alt ajan sistemini sınadım. **İki gerçek kusur** çıktı.

## Kusur 1: `websearch` tamamen bozuktu

Ölçüm: "Electron utilityProcess documentation" araması **WhatsApp indirme
linkleri** döndürdü.

Kök neden ölçüldü:

```
GET bing.com/search?q=Electron+utilityProcess+documentation
→ HTTP 200, 97 KB HTML
→ <li class="b_algo"> sayısı: 0
→ <h2> sayısı: 0
```

Yani ayrıştırıcı bozuk değildi; **Bing otomatik isteklere sonuç sayfası
vermiyor**. Sayfada yalnızca reklam/navigasyon blokları kalıyor, ayrıştırıcı
da onları sonuç sanıyor.

### Sağlayıcı ölçümü (bu makine, 13 Kasım 2026)

| Sağlayıcı | Durum | Sonuç |
|---|---|---|
| **DuckDuckGo HTML** | 200, ~33 KB | **10 doğru sonuç** (electronjs.org) |
| DuckDuckGo Lite | 200 | 0 sonuç (farklı DOM) |
| Brave HTML | 429 | engellendi |
| Wikipedia API | 200 | yalnızca ansiklopedik |
| Bing HTML | 200 ama sonuçsuz | reklam blokları |
| Google CSE | anahtar gerekir | anahtar varsa en iyi |

### Düzeltme

`src/main/agent/websearch.ts` — sağlayıcı **zinciri**:

```
Google CSE (anahtar varsa) → DuckDuckGo → Bing (son çare)
```

- Her sağlayıcı sırayla denenir; biri boş dönerse sonrakine geçilir.
- Hata mesajı hangi sağlayıcıların neden başarısız olduğunu listeler.
- `EVREN_WEBSEARCH_PROVIDER` ile zorlanabilir.
- Ayrıştırıcılar saf fonksiyon: `parseDuckDuckGo`, `parseBing`,
  `parseGoogleCse`, `decodeDuckDuckGoRedirect`.

Düzeltme sonrası aynı sorgu:

```
Arama (DuckDuckGo): Electron utilityProcess documentation

1. utilityProcess - Electron
   https://www.electronjs.org/docs/latest/api/utility-process
   utilityProcess creates a child process with Node.js and Message ports enabled…
```

## Kusur 2: alt ajanların araç çağrıları görünmüyordu

Alt ajan yalnızca `tool-result` olayı yayınlıyordu, `tool-call` değil. Yani:

- Arayüz alt ajanın **ne yaptığını** gösteremiyordu
- Testler hangi araçların kullanıldığını gözleyemiyordu
- `session-events.jsonl` alt ajan araç çağrılarını kaçırıyordu

Düzeltme: alt ajan artık `tool-call` yayınlıyor ve çağrıya `agentType` +
`subagentTaskId` ekleniyor. Böylece hangi çağrının hangi ajana ait olduğu
görünüyor.

## Sınamanın sonucu: web üzerinde paralel alt ajanlar

Üç alt ajan, üç ayrı konu, paralel (gerçek model, gerçek ağ):

| Ajan | Süre | Kullandığı araçlar | Birincil kaynak |
|---|---|---|---|
| electron | ~70 sn | `websearch`, `webfetch` | electronjs.org |
| sqlite | ~60 sn | `websearch`, `webfetch` | sqlite.org |
| rust | 36 sn | `websearch`, `webfetch` | doc.rust-lang.org |

Toplam paralel süre: **86 saniye**.

**Kaynak çeşitliliği doğrulandı:**

```
kaynak alan adları: electronjs.org, releases.electronjs.org, github.com,
                    sqlite.org, doc.rust-lang.org
```

Hiçbir URL tekrar etmiyor, her ajan kendi konusunda kaldı, çapraz kirlenme yok
(electron ajanı WAL'dan, sqlite ajanı Clone'dan hiç bahsetmedi).

## Sorunuzun cevabı: ajanlar birbirinden haberdar DEĞİL

Bu **tasarım gereği** ve testle sabitlendi:

> Her alt ajan yalnızca kendi istemini ve kendi araç çıktısını görür.
> Paylaşılan bağlam yok.

Neden:

1. **Cognition ilkesi** — paylaşılan bağlam, ajanların örtük kararlarını
   çelişkili hâle getirir; birleştirme kurtarılamaz (Flappy Bird örneği).
2. **Bağlam izolasyonu** — alt ajanın varlık sebebi, ana bağlamı
   kirletmeden çalışması. Ajanlar birbirinin bulgularını görseydi, her biri
   diğerinin bağlamını da taşımak zorunda kalırdı (N ajan = N² bağlam).
3. **Ölçüm** — bu testte her ajanın "gördüğü" metin denetlendi: hiçbiri
   diğerinin konusunu içermiyor.

Peki "haberdar" olmadan farklı kaynaklara nasıl gidiyorlar? **Ana ajan
görevleri bölerken** farklı kaynak/alan atadığı için. Bu, merkezî
koordinasyon; ajanlar arası iletişim değil.

## İsterseniz eklenebilecek: paylaşılan bulgu panosu

Ajanların birbirini görmesi *istenirse* doğru yol, doğrudan bağlam paylaşımı
değil **yapısal pano**:

```
reconBoard.write(taskId, { url, claim, evidence })
reconBoard.read(exceptOwn)   // yalnızca URL + tek satır iddia
```

- Yalnızca **URL + tek satır iddia** paylaşılır (tam bağlam değil)
- Ajan kendi bulgusunu yazmadan önce panoyu okur: "bu kaynağa başkası gitti"
- Kaynak tekrarı biter, bağlam şişmez

Bu, Cognition'ın itirazını (örtük karar paylaşımı) ihlal etmez çünkü paylaşılan
şey *karar* değil *kaynak işareti*. Maliyeti düşük, faydası ölçülebilir.

**Şu an eklemedim** — çünkü mevcut testte kaynak tekrarı zaten yoktu (0 tekrar
URL). Pano ancak tekrar gözlemlenirse gerekli.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `websearch-parse-test` | 46 | DDG/Bing/Google ayrıştırma, yönlendirme çözümü, sağlayıcı sırası |
| `agent-live-web-test` | 12 | Gerçek ağ: 3 paralel ajan, kaynak çeşitliliği, haberdarlık |

Toplam: **59 paket / 1388 kontrol** (önceki 58/1342). typecheck ✓ build ✓ e2e ✓

`agent-live-web-test` gerçek ağa çıktığı için `test:unit` dışında:

```bash
node scripts/run-unit.cjs scripts/agent-live-web-test.ts
```

## Bilinen sınırlar

- DuckDuckGo HTML arayüzü resmî API değil; DOM değişirse ayrıştırıcı kırılır.
  Bu yüzden zincir var ve hata mesajı hangi sağlayıcının düştüğünü söylüyor.
- Alt ajan `browser` aracını kullanmıyor (yalnızca `websearch`/`webfetch`).
  JS gerektiren sayfalar `webfetch` ile okunamaz.
- Sayfa başına içerik sınırı webfetch'te mevcut; çok büyük sayfalar kesilir.
