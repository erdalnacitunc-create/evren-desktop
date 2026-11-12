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
SignPath Foundation başvurusu Ekim 2026'da reddedildi; bu beta installer
imzasızdır. Windows SmartScreen “Bilinmeyen yayıncı” uyarısı gösterebilir.
İmzalama seçenekleri (yeniden başvuru veya ticari sertifika) ileride
değerlendirilecektir.

- Gizlilik: `PRIVACY.md`
- Güncelleme: `docs/UPDATE.md`
- SignPath: `docs/SIGNPATH.md`
