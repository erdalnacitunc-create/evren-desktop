# EVREN Desktop

EVREN LLM API'si (OpenAI ve Anthropic uyumlu) icin acik kaynak Windows masaustu
istemcisi. Kullanici, resmi sayfadan (`evren.ssyz.org.tr/api-keys`) aldigi API
anahtarini ekleyerek erisebildigi modelleri kullanir.

- **Lisans:** MIT (bkz. `LICENSE`)
- **Temiz oda / yasal ilkeler:** bkz. `docs/LEGAL.md`
- **Plan:** `docs/PLAN.md`
- **API notlari:** `docs/API-NOTES.md`
- **Web arama:** `docs/WEBSEARCH.md`
- **External references:** `docs/REFERENCES.md`
- **Code Mode:** `docs/CODE-MODE.md`
- **USB / seri port:** `docs/USB.md`
- **Guvenlik denetimi:** `docs/AUDIT.md` (`npm run audit:security`, `npm run test:e2e`)
- **Code signing policy:** [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md)
- **Code of conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## Code signing policy

The SignPath Foundation application was **not approved** in October 2026
because the project has not yet established the required level of public
visibility. Windows releases are therefore **unsigned**.

If signing is added in the future, only Windows artifacts built by GitHub
Actions from this repository will be submitted for signing. This project does
not store a code-signing private key. See
[`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md) for the full policy, status,
team roles, and verification instructions.

## Gelistirme

```bash
npm install
npm run dev        # gelistirme (HMR)
npm run build      # uretim derlemesi
npm run build:win  # Windows NSIS kurulum paketi
```

## Arayuz notlari
- Ajan (araclar) araç destekleyen modellerde varsayilan olarak aciktir.
- **Çoklu Evren:** ana model + tüm uygun modeller paralel, ana model sentezler.
  Uyeler aracsizdir; her calistirmada maliyet onayi istenir.
- Sag tik: Geri Al / Yinele / Kes / Kopyala / Yapistir / Tumunu Sec + baglanti/resim.
- Uzantilar: Ayarlar > Uzantilar (MCP'ler / Eklentiler / Beceriler).
- **MCP tarayıcısı:** **Ayarlar > MCP** ile bağlı sunucuların kaynaklarını okuyun,
  promptlarını Composer'a ekleyin, araçlarını çalıştırın ve görevlerini yönetin.
  Sunucu `elicitation/create` isterse form veya URL onay penceresi açılır.
  Ayrıntılar: `docs/MCP.md`.
- **Headless API / SDK / ACP:** **Ayarlar > API** ile yerel OpenAI uyumlu HTTP
  sunucusunu açın, token’ı kopyalayın; `sdk/evren-client.mjs` ile kullanın.
  ACP istemcileri için `acp/evren-acp-bridge.cjs`. Ayrıntılar:
  `docs/HEADLESS.md`.
- **Terminal:** Sohbet altında **Terminal** (`Ctrl+backtick`) ile kalıcı PowerShell
  oturumu. Python/Node/PowerShell/Bash kod bloklarında **▶** ile tek tuşla
  çalıştırma. Ayrıntılar: `docs/TERMINAL.md`.
- **Önerilen yanıtlar:** Model “bağlandı yaz” gibi bir geri bildirim beklediğinde
  composer üstünde öneri çipleri ve **Onayla ve gönder** düğmesi çıkar.
  Ayrıntılar: `docs/SUGGESTED-REPLIES.md`.
- **Çalışma Alanı:** Üst çubuktan bir proje klasörü seçin. Model gerçek dosyaları
  okuyabilir, oluşturabilir, düzenleyebilir, silebilir; `glob`/`grep` ile arayabilir
  ve `run_command` ile komut çalıştırabilir. Sağdaki **Dosyalar** panelinde dosya
  ağacı, değişiklik geçmişi, unified diff ve **Geri Al** bulunur. Ayrıntılar:
  `docs/WORKSPACE.md`.
- **Plan / Build:** Composer'daki küçük anahtar veya `Shift+Tab`. Plan modu yalnızca
  okuma/arama yapar; plan ve görev listesi üretir. **Planı uygula** ile Build'e geçin.
- **Görevler:** Model `todo_write` kullandığında görevler sağ panelde görünür;
  durum göstergesine tıklayarak açın. Görevler oturumla birlikte saklanır.
- **Zamanlanmış görevler:** **Ayarlar > Görevler** ile tek seferlik, aralıklı veya
  günlük promptlar oluşturun. Her çalışma yeni bir oturum açar, yalnızca sohbet
  yanıtı üretir ve masaüstü bildirimi gösterir. Ayrıntılar:
  `docs/SCHEDULED-TASKS.md`.
- **İzinler:** Ajan panelinde kategori bazlı `Sor / İzin / Engelle`. Onay kartında
  **Her zaman izin ver** seçeneği ilgili kategoriyi otomatik izinli yapar.
- **Checkpoint:** Her dosya aracı adımından sonra araç kartında **Bu adımı geri al**
  düğmesi görünür; adımdaki tüm dosya değişikliklerini geri alır.
- **Dosya bağlamı:** Composer'da `@` veya **@ Dosya** ile çalışma alanından dosya
  ekleyin; içerik model bağlamına eklenir. **📎 Ekle** veya panodan yapıştırma ile
  metin dosyası/görsel eklenebilir; görseller vision destekli modellerde gönderilir.
- **Kontroller:** **Dosyalar > Kontroller** sekmesinde projedeki typecheck/lint/test
  scriptleri çalıştırılır; sonuçlar çıkış kodu ve çıktıyla gösterilir. Model de
  `run_checks` aracıyla aynı kontrolleri çalıştırabilir.
- **Git:** Sağdaki **Git** panelinde branch, değişiklikler, diff, stage/unstage ve
  commit; ayrıca worktree oluşturma, açma ve kaldırma. Model `git` aracıyla aynı
  işlemleri yapabilir.
- **Canlı önizleme:** İnceleme panelinde Markdown, HTML (sandbox), Mermaid, CSV/TSV
  ve SVG önizlemesi; PDF için **Kaydet ve aç**. Ayrıntılar: `docs/PREVIEW.md`.
- **Sesli giriş:** Composer’da **🎙 Ses** ile kayıt → transkripsiyon → metin.
  Ayrıntılar: `docs/VOICE.md`.
- **GitHub hesabı:** **Ayarlar > GitHub** ile PAT bağlama, profil/kapsamlar,
  repo listesi ve bağlantıyı kesme. Ayrıntılar: `docs/GITHUB-ACCOUNT.md`.
- **Pencere:** Özel başlık çubuğu; sürükleyerek taşıma, çift tıkla büyütme,
  modern küçült/büyüt/kapat düğmeleri. Uygulama simgesi `resources/icon.png`.

## Durum
- [x] M0 Recon (API sozlesmesi, klasor)
- [x] M1 Iskelet (Electron + React + TS)
- [x] M2 Anahtar + Modeller
- [x] M3 Streaming sohbet
- [x] M4 Oturumlar
- [x] M5 Ayarlar + Kota
- [x] N1 Tool-calling çekirdeği
- [x] N2 Tarayıcı aracı (Playwright + Edge)
- [x] N3 Computer use (deneysel)
- [x] E1 Uzantılar (Beceri + GitHub)
- [x] E2 MCP uzantıları
  - [x] yapılandırma düzenleme (yerel/uzak)
  - [x] uzak HTTP testi
  - [x] OAuth (loopback callback + DPAPI token)
  - [x] kaynaklar + kaynak şablonları (Ayarlar > MCP)
  - [x] promptlar + argüman formu + Composer'a ekleme
  - [x] elicitation (form + URL onayı)
  - [x] görevler: listele / iptal / sonuç, task-augmented araç çağrısı
- [x] Headless API + SDK + ACP
  - [x] yerel OpenAI uyumlu HTTP proxy + token (DPAPI)
  - [x] oturum uç noktaları (`/v1/sessions`)
  - [x] `sdk/evren-client.mjs` (fetch tabanlı)
  - [x] ACP v1 stdio köprüsü + izin istekleri + çalışma alanı
- [x] Entegre terminal
  - [x] kalıcı PowerShell oturumu + komut geçmişi
  - [x] kod bloklarında ▶ ile Python/Node/PowerShell/Bash çalıştırma
  - [x] `Ctrl+backtick` ve komut paleti
  - [x] önerilen yanıt çipleri + tek tıkla onaylama
- [x] E3 Eklenti uzantıları
  - [x] izole utility process + vm sandbox
  - [x] izin manifesti (network/storage)
  - [x] örnek eklenti + format dokümanı
- [x] Çoklu Evren (çoklu-model sentezi)
- [x] Komutlar + Compaction + Hafıza
  - [x] `/` komut paleti (10 yerleşik + özel + beceriler)
  - [x] `/compact` + otomatik compaction (%80, 15K keep)
  - [x] DPAPI şifreli hafıza + embedding getirim + otomatik çıkarım
- [x] İnceleme paneli (artifact) + görev göstergesi
- [x] W1 Çalışma alanı (dosya araçları)
  - [x] read/write/edit/delete/create_directory/list/glob/grep/run_command
  - [x] dosya ağacı + unified diff + değişiklik geçmişi
  - [x] yedekleme + son değişikliği geri alma
  - [x] çalışma alanı sınırı, `.git` koruması, onaylı/otomatik mod
- [x] W2 Planlama ve güvenli çalışma
  - [x] Plan / Build modu + `Shift+Tab`
  - [x] kalıcı görev listesi (`todo_write`)
  - [x] kategori bazlı izinler + "Her zaman izin ver"
  - [x] adım bazlı checkpoint + geri alma
  - [x] `@dosya` bağlamı ve kompakt sağ panel
  - [x] görsel/metin eki + panodan yapıştırma
- [x] W3 (ilk dilim) Proje kontrolleri
  - [x] typecheck / lint / test / build algılama
  - [x] Dosyalar > Kontroller paneli
  - [x] `run_checks` ajan aracı
- [x] W3 Git paneli + worktree
  - [x] status / diff / stage / unstage / commit
  - [x] remote algılama + push
  - [x] worktree oluştur / aç / kaldır
  - [x] `git` ajan aracı
  - [x] GitHub CLI varsa PR oluşturma + PR/CI durumu
- [x] W3 Alt-ajanlar
  - [x] `spawn_agent`: explore / review / general
  - [x] ayrı bağlam + özet dönüş
  - [x] arka plan görevleri: background=true + task_wait/status/list/cancel
  - [x] görev panelinde canlı durum + iptal
  - [x] görev geçmişinin kalıcı saklanması (kesilenler `interrupted`)
  - [x] kesilen görevleri yeniden deneme + açılışta otomatik sürdürme (opsiyonel)
- [x] W3 Repo map / kod haritası
  - [x] `repo_map` ajan aracı
  - [x] Dosyalar > Harita sekmesi
  - [x] anlamsal/embedding kod indeksi
- [x] W3 Hook’lar
  - [x] düzenleme sonrası Prettier format hook’u
  - [x] commit öncesi typecheck/lint/test kontrolü
- [x] Taşınabilir GitHub CLI + token ile PR/CI
- [x] Modern pencere çerçevesi + EVREN logosu
- [x] M7 Cilalama (ilk dilim)
  - [x] global komut paleti (`Ctrl+K`) + kısayollar
  - [x] hata sınırı (error boundary)
  - [x] sistem tepsisi + masaüstü bildirimleri
  - [x] tema: koyu / açık / sistem
  - [x] erişilebilirlik: odak halkaları, reduced-motion, aria
  - [x] canlı artifact önizleme (HTML/Mermaid/CSV/SVG/PDF kaydet+aç)
  - [x] sesli giriş / transkripsiyon
- [x] GitHub hesabı bağlama (PAT)
  - [x] profil / kapsam / repo listesi
  - [x] bağlan / bağlantıyı kes
  - [x] OAuth Device Flow (kendi Client ID’niz ile)
  - [x] GitHub App + installation token (App ID + private key)
- [x] Zamanlanmış görevler
  - [x] tek seferlik / aralıklı / günlük
  - [x] model seçimi, yeni oturum, bildirim
  - [x] şimdi çalıştır / duraklat / sil + son sonuç
  - [ ] araç kullanımı / arka planda kapalıyken çalışma
- [x] M6 Windows paketleme (beta)
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
SignPath Foundation başvurusu Ekim 2026'da reddedildi; bu beta installer
imzasızdır. Windows SmartScreen “Bilinmeyen yayıncı” uyarısı gösterebilir.
İmzalama seçenekleri (yeniden başvuru veya ticari sertifika) ileride
değerlendirilecektir.

- Gizlilik: `PRIVACY.md`
- Güncelleme: `docs/UPDATE.md`
- SignPath: `docs/SIGNPATH.md`
