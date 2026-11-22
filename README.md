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
# 0.4.24 Beta — doğrulama kapısı + taze bağlamlı inceleme

Alt ajan mimarisinde **ölçümün kendisi** güçlendirildi. Yeni yetenek değil;
yanlış "bitti" raporları yapısal olarak kapatıldı.

| Katman | Ne yapar |
|---|---|
| Doğrulama kapısı | `general` ajanı yazdıysa typecheck/test **kod tarafından** çalışır; geçmezse model en fazla 2 tur düzeltmeye geri gönderilir |
| İnceleme paketi | `review` ajanı bu oturumdaki değişikliklerin diff'ini hazır bağlam alır |

Ölçemediğinde başarı göstermez: kontrol tanımsızsa, kapı çöktüyse veya bütçe
kesildiyse rapor **"doğrulanmadı"** der. Düzeltme istemi testi
silmeyi/gevşetmeyi açıkça yasaklar (reward-tampering savunması).

Ana ajana yansıma: `spawn_agent` sonucu `[DOĞRULAMA ✓]` ·
`[DOĞRULAMA BAŞARISIZ]` · `[DOĞRULAMA YOK — doğrulanmadı]` etiketi taşır.

**80 paket · 1963 kontrol**. Ayrıntı: `docs/RELEASE-0.4.24.md`,
`docs/VERIFICATION-GATE.md`.

# 0.4.23 Beta — eval katmanı: kalite ölçümü (OpenAI Evals paterni)

Deterministik testler "kod yolu doğru mu" sorusunu yanıtlıyordu; **"çıktı iyi
mi"** ölçülmüyordu. İki katman eklendi:

| Katman | Ne yapar |
|---|---|
| Basic eval | Kural tabanlı: regex, uzunluk, yasak ifade |
| Model-graded | LLM hakem, ağırlıklı rubrik |

Rubrik: doğruluk 0.30 · kanıt 0.20 · tamlık 0.20 · **dürüstlük 0.20** ·
verimlilik 0.10. 5 senaryo, her biri geçmişte gerçekten yanlış giden bir
davranışı hedefliyor (uydurma `/status` ucu, çöp arama sonucu, olmayan dosyayı
uydurma, araç israfı, "erişim kısıtı" bahanesi).

## Ölçümün kendisinde bulunan iki kusur

1. **Hakem sessizce boş dönüyordu** — yanlış API yolu (`/chat/completions` →
   404) ve hata yutuluyordu. Bu, 0.4.14/0.4.16 kusurlarının **üçüncü tekrarı**:
   başarısızlığı başarı gibi raporlamak.
2. **Kesilen JSON tüm puanı siliyordu** — `max_tokens` sınırında model tam
   ortada kesiliyor, `JSON.parse` başarısız oluyor, hiçbir ölçüt
   kurtarılmıyordu. Artık tam JSON → yoksa regex ile kısmi kurtarma.

Kanıt (`judge-live-test`, gerçek sağlayıcı): orta kaliteli çıktı → beş ölçüt,
**0.30**. Hakem ayırt edici.

**77 paket · 1886 kontrol**. Ayrıntı: `docs/RELEASE-0.4.23.md`,
`docs/EVALS.md`, `docs/VERIFICATION-EVALS-2TUR.md`.

# 0.4.22 Beta — üst çubukta güncelleme düğmesi

Güncelleme akışı Ayarlar > Genel'e gömülüydü. Üst çubuğa **her zaman görünür**
bir düğme eklendi; tek tıkla ilerler:

`idle` → denetle · `available` → **mavi rozet + nabız** "v0.4.22 hazır — indir" ·
`downloading` → yüzde · `downloaded` → **yeşil** "Kur ve yeniden başlat" ·
`error` → kırmızı "yeniden dene" · `disabled` → gizli.

Referans: opencode / Antigravity deseni. Davranış tablosu `lib/updateButton.ts`
içinde saf fonksiyon; `update-button-test` (30 kontrol) ile doğrulanır.
Koyu/açık tema, `prefers-reduced-motion`, dar ekranda yalnızca ikon.

Toplam: **74 paket / 1821 kontrol**. Önizleme:
`docs/update-button-preview.html`. Ayrıntı: `docs/RELEASE-0.4.22.md`.

# 0.4.21 Beta — hız: alt ajan paralelliği, ön okuma, prompt önbelleği

0.4.20 darboğazı: adım başına **88 sn**, araç payı **<%2**. Üç kaldıraç:

1. **Alt ajan içinde paralel araç** — hazırlık (izin/onay) sıralı, yürütme
   paralel; salt-okunur çağrılar donanım profiline göre eşzamanlı, yazma varsa
   hepsi seri. Kanıt: `paralel araç: 3 çağrı · 3 eşzamanlı`.
2. **Ön okuma (warm start)** — istemde adı geçen dosyalar ajan başlamadan
   okunup bağlama konur (en fazla 8 dosya, 60 kB); isteme "tekrar okuma,
   analize geç" notu. Ajan başına 2-5 adım kazanç.
3. **Prompt önbelleği** — eski tur kırpma artık yalnızca bağlam 80 kB'ı
   geçince (önek bozulmasın); Anthropic için `cache_control` desteği
   (`EVREN_PROMPT_CACHE=anthropic`); sistem istemi parmak iziyle değişim uyarısı.

## Doğrulama

`prefetch-cache-test` 40, `subagent-parallel-e2e-test` 8. Toplam:
**73 paket / 1791 kontrol**. Ayrıntı: `docs/RELEASE-0.4.21.md`.

# 0.4.19 Beta — alt ajan rapor bütçesi (süre ve kısmi sonuç)

0.4.18 üç fazlı koşusu: alt ajan adımı başına **88 sn**, araç payı **<%2**,
en uzun tek adım **503 sn**, faz 2'de **3/3 kısmi**. Süre araçlarda değil,
modelin tek parçada 4-8 bin karakterlik rapor üretmesinde.

**Düzeltme:** rapor **450 kelime** ile sınırlandı — hem istemde (madde işareti,
kod bloğu yok, giriş/sonuç paragrafı yok) hem kodda (`applyReportBudget`,
cümle sonunda keser). Sentez ve %75 bütçe uyarısı aynı sınırı taşıyor. Ayrıca
"3-5 adım içinde yazmaya başla, tek büyük raporu sona bırakma" kuralı eklendi.

## Doğrulama

`report-budget-test` 24 kontrol. Toplam: **69 paket / 1681 kontrol**.
Canlı ölçüm: `subagent-report-live-test` (3 paralel explore ajanı).
Ayrıntı: `docs/RELEASE-0.4.19.md`.

# 0.4.18 Beta — koordinasyon da ilerlemedir; alt ajan bütçesi ve kuyruk

Üç fazlı canlı sınamada (proje incelemesi / web araştırması / kodlama) iki yeni
kusur ve bir ölçüm hatası bulundu.

**Kusur 1 — sert eşik koordinasyonu ilerlemesiz saydı.** Ana ajanın adımları
`spawn_agent` → `task_wait` → `task_wait` iken yönlendirme yine tetiklendi
(günlükte `0 adım metinsiz` — çelişkinin kendisi). Sert eşik yalnızca ham adım
sayısına bakıyordu. Artık `coordinationSignals` ilerleme sayılıyor; sert eşik
12 adıma çıktı ve son 6 adımda taze ilerleme varsa erteleniyor.

**Kusur 2 — alt ajan bütçesi dar.** Faz 1'de 3/3 ajan kısmi döndü
(`akış bütçesi doldu (387 sn)`). Araçlar 1-3 sn; zaman modelin rapor
üretiminde. Varsayılan 420 → **600 sn**, %75 uyarısı daha buyurgan.

**Kusur 3 — kuyrukta 5 dk boşa bekleme.** 4. spawn 300 sn bekleyip reddedildi,
model tekrar denedi ve geçti. Kuyruk zaman aşımı 300 → **90 sn**; ret mesajı
"hiç açma" yerine "önce `task_wait` ile birini al" diyor.

**Ölçüm hatası:** 0.4.17 testi "okuma sırasında yönlendirme 0" diyordu ama
yönlendirme olay akışına yayınlanmıyor; kontrol boştu. Artık `main.log`
satırları zaman penceresiyle sayılıyor.

## Doğrulama

`progress-guard-test` 63 (önceki 44), `agent-subagent-limit-test` 48.
Toplam: **68 paket / 1657 kontrol**. typecheck ✓ build ✓ e2e ✓
Ayrıntı: `docs/RELEASE-0.4.18.md`.

# 0.4.17 Beta — ilerleme koruması okumayı "ilerleme" saymıyordu

Bellek temizlenmiş hâlde aynı sorgu 0.4.16 ile yeniden koşuldu: Code Mode
düzeltmesi tuttu (15/15 kontrol), ama canlı koşu yeni bir kusur ortaya çıkardı.

Model dosya **okurken** yönlendirme tetiklendi:

```
[warn] İlerlemesiz döngü: 4 adım metinsiz — yönlendirme #1
[warn] İlerlemesiz döngü: 5 adım metinsiz — yönlendirme #2
```

Yönlendirme *"yeni tarama başlatma, araç çağırmayı bırak"* diyor. Model uydu:
1886 kr yarım rapor, **sıfır alt ajan** — oysa istem alt ajan istiyordu.

Kök neden: `shouldNudgeProgress` yalnızca **metin** uzunluğuna bakıyordu; dosya
okuyan adım da "metinsiz" sayılıyordu.

**Düzeltme:** okuma = ilerleme. Adımda başarılı ve içerik üreten bir okuma varsa
o adım ilerlemesiz sayılmaz. Güvenlik ağı olarak **8** ardışık metinsiz adımda
okuma olsa bile yönlendirme gönderilir.

Bellek (`memory.bin`, 442 KB) yedeklenip silindi; koşu 0 hafıza kaydıyla başladı.

## Doğrulama

`progress-guard-test` 44 (önceki 30). Toplam: **68 paket / 1636 kontrol**
(önceki 68/1622). typecheck ✓ build ✓ e2e ✓
Ayrıntı: `docs/RELEASE-0.4.17.md`.

# 0.4.16 Beta — Code Mode sessiz başarısızlığı

İki paralel canlı sorguda (aynı istem, farklı model) bulundu: `gemma-4-31b`
oturumunda 14 `execute` çağrısının **13'ü** `{}`/`undefined` döndürdü — ve hepsi
**`ok: true`** raporlandı. Model 11 dosyayı okuduğunu sandı, hiçbirini okumadı;
raporu dosya adlarından yazdı ve *"dosya erişim kısıtları yaşandı"* diye yanlış
gerekçe verdi (`/status`, `/command` gibi uydurma uç noktalarla).

Kök neden: `tools.*` çağrıları `{ ok, content }` döndürürken model `.stdout`
okudu; tüm değerler `undefined` kaldı, `JSON.stringify` `{}` üretti.

**Düzeltme:** boş sonuç artık **hata** (`undefined`, `null`, boş metin, `{}`,
`[]`). Hata mesajı yolu gösterir: `return` gerektiği ve doğru alanın `content`
olduğu. Araç açıklaması da sözleşmeyi baştan yazar.

Aynı hata sınıfı 0.4.14'te `task_wait` ile yaşanmıştı: sessiz başarısızlık
başarı gibi raporlanınca model yanlış yola sapıyor.

## Aynı istem, iki model

| | gemma-4-31b | deepseek-v4.1-flash |
|---|---|---|
| Süre | 720 sn | 1092 sn |
| Araç | 25 | 26 |
| Boş `execute` | **13** | **0** |
| Alt ajan | 3 | 4 |
| Yanıt | 600 kelime | 1124 kelime |

## Doğrulama

`code-mode-empty-test` (17 kontrol). Toplam: **68 paket / 1622 kontrol**
(önceki 67/1605). typecheck ✓ build ✓ e2e ✓
Ayrıntı: `docs/RELEASE-0.4.16.md`.

# 0.4.15 Beta — web araması onarımı, alt ajan bütçesi, yinelenen rapor

0.4.14 canlı koşusunda üç kusur bulundu:

| Kusur | Ölçüm | Düzeltme |
|---|---|---|
| `websearch` bozuk | 15 aramanın **9'u başarısız**, 2'si alakasız ("Cleveland doğum hasarı avukatı") | Sade Bing URL + **alaka süzgeci** + bot-koruması tespiti (5 dk cooldown) + **Google News RSS yedeği** + sağlayıcı hafızası |
| Alt ajan bütçesi uygulanmıyor | 482 ve 575 sn süren ajanlar (bütçe 210 sn); zaman araçlarda değil, **tek parça 291/423 sn model üretiminde** | Bütçe **akışa** uygulanır: kalan süre `totalTimeoutMs`, dolunca **kısmi sonuç** + `task_continue`; %75'te toparlama hatırlatması |
| Rapor iki kez yazıldı | 9,2k kr taslak + 19,5k kr birleşik rapor | Bildirim metni: "yanıtı baştan yazma, yeni bulguları ekle" |

Arama onarımının özü: sağlayıcı "sonuç var" diye kabul edilmiyor — sorgu
sözcüklerinin en az %50'si sonuçlarda geçmeli. Bing'in başka sorguya döndürdüğü
sayfalar (Lidl, doğum hasarı avukatı) böylece reddediliyor.

## Doğrulama

| Paket | Kontrol |
|---|---|
| `websearch-parse-test` | 86 |
| `websearch-live-test` (gerçek ağ) | 14 |
| `subagent-deadline-test` | 12 |
| `subagent-log-test` | 21 |
| `subagent-wait-test` | 21 |

Toplam: **67 paket / 1605 kontrol** (önceki 66/1553). typecheck ✓ build ✓ e2e ✓
Ayrıntı: `docs/RELEASE-0.4.15.md`.

# 0.4.14 Beta — alt ajan bekleme kusuru, devam ettirme, ayrıntılı izleme

Canlı takipte iki kusur bulundu: `task_wait` zaman aşımı **hata gibi** dönüyordu
(alt ajan 186 sn'de bitip 4820 kr sonuç üretti, ana ajan hiç almadı) ve ilerleme
güncellemesi bekleyen `task_wait`'i erken uyandırıyordu. İkisi de düzeltildi.

## Yeni davranış

| | Önce | Şimdi |
|---|---|---|
| Görev sürerken `task_wait` | `ok:false` + tüm görev JSON'u | **`ok:true`** + "hâlâ çalışıyor, hata değil" + ilerleme |
| Sonuç teslimi | yalnızca `task_wait` | + **tur içi otomatik bildirim** (opencode `<subagent>`) |
| Biten ajanı sürdürme | yok | **`task_continue`** (Claude Code `resume`) |
| `task_status` | tam JSON (istem dâhil) | kompakt özet + adım/araç ilerlemesi |
| Alt ajan izleme | `main.log` tek satır | **`subagent-events.jsonl`** + `task_logs` aracı |
| `spawn_agent` | istem | + kısa `description` |

İzleme günlüğü her araç çağrısını **süresiyle**, bütçe kesintilerini, izin/araç
hatalarını ve durum geçişlerini kaydeder; sırlar maskelenir. Karşılaştırma:
`docs/SUBAGENT-ARCHITECTURE.md`.

## Doğrulama

| Paket | Kontrol |
|---|---|
| `subagent-log-test` | 21 |
| `subagent-wait-test` | 21 |
| `agent-subagent-limit-test` | 46 |
| `file-ownership-*` | 78 |

Toplam: **66 paket / 1553 kontrol** (önceki 64/1511). typecheck ✓ build ✓ e2e ✓
Ayrıntı: `docs/RELEASE-0.4.14.md`.

# 0.4.13 Beta — dosya sahipliği (Katman A)

Paralel kodlama güvenli hâle geldi: **iki alt ajan aynı dosyaya yazamaz.**

## Nasıl

1. Ana ajan `spawn_agent` çağırırken `files` listesi verir (ajanın yazabileceği
   dosya/dizin/glob'lar).
2. Çakışan bir yol zaten sahipliyse spawn **reddedilir**; modele sahibi söylenir.
3. Liste dışına yazma **araç düzeyinde** reddedilir — istem kuralı değil, kod
   garantisi.

Çakışma *tespit edilmez*, **imkânsız olur**. Ajanlar aynı ağaçta çalışır:
`node_modules`, `.env`, `secrets.h`, `run_checks` yerinde kalır. Worktree'nin
çözdüğü tek sorun buydu; worktree Katman B olarak opt-in kalıyor
(`docs/WORKTREE-DECISION.md`: izlenen dosyaların yalnızca %2,3'ünü görür).

Desenler: `src/a.ts` · `src/module/` · `src/**/*.ts`. İki desen yalnızca statik
önekleri kesişiyorsa çakışır; `src/auth/` ile `src/billing/` birbirini engellemez.

## Yol boyunca bulunan iki sessiz hata

| Hata | Etki | Düzeltme |
|---|---|---|
| Kapı sızıntısı | Reddedilen spawn slotu geri vermiyordu; kapasite yarıya indi, ajanlar sırayla koştu, çakışma hiç oluşmadı | Doğrulama `acquire()`'dan önce; çakışma reddi `refund()` ile slot **ve** bütçe iadesi |
| Alt ajan `tool-result` yok | Arayüz alt ajanın araç sonucunu göremiyordu; sahiplik ihlali görünmezdi | `ToolResultInfo` + her yolda sonuç yayını (`agentType`/`subagentTaskId` ile) |

Kapı sızıntısı teşhisi: claim'ler 13 sn arayla alınıyordu — ajanlar paralel
değil, sıraydı.

## Canlı sınama (gerçek model, üretim yolu)

6 dosyalı, iki bağımsız modüllü proje; görev iki `general` ajana bölündü.

| | |
|---|---|
| Süre | **235 sn** |
| `spawn_agent` | 2 (ikisi de kabul) |
| Sahiplik | `["src/auth/"]` + `["src/billing/"]` — çakışma **0** |
| Yazma | 6 |
| Sonuç | 6/6 hata düzeltildi |

Model `files` listesini kendiliğinden doğru verdi; hiçbir ajan diğerinin
dosyasına dokunmadı.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `file-ownership-test` | 52 | Normalizasyon, glob/dizin çakışması, tablo atomikliği, yazma izni |
| `file-ownership-enforce-test` | 14 | Araç düzeyi zorlama (write/edit/delete) |
| `file-ownership-loop-test` | 12 | Döngü: files zorunlu, çakışma reddi, kapı sızıntısı |
| `agent-subagent-limit-test` | +4 | `refund()` slot ve bütçe iadesi |

Toplam: **64 paket / 1511 kontrol** (önceki 61/1429). typecheck ✓ build ✓ e2e ✓
Ayrıntı: `docs/RELEASE-0.4.13.md`.

# 0.4.12 Beta — iki canlı sınama, web araştırma ipucu, kodlama devri analizi

İki sorgu üretim yolundan (gerçek model, gerçek ağ/disk) çalıştırıldı ve canlı
ölçüldü.

## Sınama sonuçları

### Sorgu 1 — yerel plc_proje (çalışma alanı = `C:\...\plc_proje`)

| | |
|---|---|
| Süre | **169 sn** |
| Araç | 12 (`read_file` 7, `glob` 2, `list_files` 1, `repo_map` 1, `run_command` 1) |
| Alt ajan | **0** |
| Retry | 0 |
| Rapor | 6303 kr, 7 katmanlı tablo, dosya referansları |

Model `repo_map` ile haritayı çıkardı, `read_file` ile 7 kritik dosyayı
(00_genel_felsefe, 05_katman_haritasi, platformio.ini …) **içerikten** okudu ve
katmanları koda eşledi. Alt ajan gerekmedi — devretmemek doğru karardı.

### Sorgu 2 — web araştırması (benzer proje)

| | |
|---|---|
| Süre | **384 sn** |
| Araç | 7 (`websearch` **4**, `execute` 2, `todo_write` 1) |
| Alt ajan | **0** |
| Retry | 0 |
| Rapor | 5578 kr, 5 katmanlı mimari tablosu |

4 arama **sırayla** yapıldı. Aradaki fark net:

| Sorgu | Süre | Neden |
|---|---|---|
| Yerel (paralel dosya okuma) | 169 sn | `read_file` 7 dosyayı tek adımda okudu |
| Web (sıralı arama) | **384 sn** | 4 bağımsız arama tek tek |

## Bulgu: web araştırması için devretme kuralı yoktu

Dosya keşfi için ipucu vardı (`Keşif ipucu: N dosya listelendi…`), web için
**hiçbir sinyal yoktu**. `explorationHint` yalnızca `list_files`/`glob`/`grep`
ve `read_file`/`repo_map`/`code_search` sayıyordu — `websearch` kapsam dışıydı.

Sonuç: 4 bağımsız arama 384 saniyede sırayla yapıldı; paralel alt ajanlarla
~100 saniyeye inebilirdi.

### Düzeltme

**1. Web araştırma ipucu** (`explorationHint.ts`):

```ts
shouldHintWebResearch(state, hintsSent, maxHints=1, minSearches=3)
```

3+ web araması yapıldıysa ve henüz alt ajan açılmadıysa modele tek seferlik
hatırlatma gider:

> DURUM: Birkaç web aramasını sırayla yaptın.
> Bu aramalar birbirinden bağımsızsa **paralel** alt ajanlarla çok daha hızlı
> tamamlanır: 2-4 `explore`, her birine **FARKLI** konu ve farklı kaynak türü
> (resmî dokümantasyon, GitHub, teknik blog), sonuçları `task_wait` ile topla…
> Aramalar birbirine bağlıysa bu ipucunu yok say.

**2. Devretme kuralına web maddesi**:

> Web araştırmasında 3+ bağımsız konu varsa (farklı teknoloji, farklı kaynak
> türü) → 2-4 `explore` paralel; her birine farklı konu ve kaynak türü ver.

## Kodlama devri: mimari uygunluk analizi

Sorunuz: model, kodlama görevini farklı dosyalara alt ajanlarla dağıtabilir mi?
Kodu denetledim.

### Teknik cevap: evet, kısmen

| Alt ajan türü | Yazma yetkisi | Nasıl |
|---|---|---|
| `explore` | **Hayır** | `readOnly = true` sabit |
| `review` | **Hayır** | `readOnly = true` sabit |
| `general` | **Evet** | `readOnly = agentType !== 'general' \|\| profile === 'plan'` |

Yani `general` alt ajanı `write_file`/`edit_file`/`run_command` kullanabilir ve
**farklı dosyalarda gerçekten kod yazabilir**. Ana ajan paralel `general`
ajanları başlatabilir.

### Ama mimari bunun için **hazır değil** — üç somut eksik

**1. Yazma çakışması koruması yok.** Kodu taradım: alt ajanlar için worktree
izolasyonu, dosya kilidi veya çakışma tespiti **yok**. İki `general` ajanı aynı
dosyaya yazarsa son yazan kazanır, diğeri sessizce kaybolur.

**2. Ana ajan ne yazıldığını görmüyordu.** Alt ajan yalnızca metin özeti
döndürüyordu; `diff` yoktu. Kodlama devrinde bu "kara kutu" demek: ana ajan
"3 dosya düzenledim" diyen bir özete güvenmek zorundaydı. **Bu sürümde
düzeltildi** — `general` ajan sonucuna değişen dosya listesi ekleniyor:

```
Değişen dosyalar (3):
- firmware/ana/config.h (düzenlendi)
- bulut/edge/index.ts (yazıldı)
- crm/sunucu.py (silindi)
```

**3. Ajanlar birbirinin kararını görmüyor.** Bu bilinçli (Cognition ilkesi:
örtük kararlar çelişir). Ama kodlamada sonucu daha ağır: iki ajan farklı dosyaya
**tutarsız** stil/arayüz yazabilir — biri `async`, diğeri `sync`; biri aynı
yardımcıyı kendi kopyasıyla, diğeri import'la. Derleme geçer, mimari bozulur.

### Mevcut hâliyle ne yapılabilir, ne yapılmamalı

| Görev | Uygun mu | Neden |
|---|---|---|
| Sır/güvenlik taraması (salt-okunur) | ✅ | `explore`/`review`, çakışma yok |
| Keşif: "bu değişiklik nereleri etkiler" | ✅ | salt-okunur |
| Test yazımı (ayrı test dosyaları) | ⚠️ | dosya ayrımı netse çalışır |
| Aynı modülde çoklu dosya düzenleme | ❌ | çakışma + tutarsızlık riski |
| Büyük refactor (paylaşılan arayüz) | ❌ | ajanlar arayüzü ayrı ayrı yorumlar |
| Bağımsız modüllerde paralel özellik | ⚠️ | ancak dosya sahipliği kesin ayrılırsa |

### Önerilen tasarım: sahiplik + worktree

Kodlama devrini güvenli kılmak için üç katman gerekir:

**a) Dosya sahipliği (zorunlu, ucuz).** Her `general` ajana **ayrı dosya
kümesi** atanır. Ana ajan spawn öncesi sahiplik tablosu tutar; iki ajana aynı
dosya verilmez. Çakışma isteği reddedilir (`spawn_agent` hatası).

**b) Worktree izolasyonu (güçlü, orta maliyet).** Her ajana `git worktree` ile
ayrı çalışma kopyası; sonuçta diff'ler ana ajana döner, ana ajan seçip uygular.
Claude Code tam bunu yapıyor (`isolation: worktree`).

**c) Arayüz sözleşmesi (tutarlılık).** Ana ajan spawn metnine paylaşılan
arayüzü (tip imzaları, yardımcı fonksiyon adları) yazar; ajanlar onu kullanır.

Bugün **a ve c** istemle kısmen yapılabilir; **b** kod gerektirir. Önerim:
önce (a) sahiplik tablosu — küçük ve ölçülebilir; (b) ancak gerçek bir çok
dosyalı refactor ihtiyacı doğduğunda.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `web-research-hint-test` | 22 | Eşik, sayaç, yapılandırma, metin kalitesi |

Toplam: **61 paket / 1429 kontrol** (önceki 60/1407). typecheck ✓ build ✓ e2e ✓
SignPath Foundation başvurusu Ekim 2026'da reddedildi; bu beta installer
imzasızdır. Windows SmartScreen “Bilinmeyen yayıncı” uyarısı gösterebilir.
İmzalama seçenekleri (yeniden başvuru veya ticari sertifika) ileride
değerlendirilecektir.

- Gizlilik: `PRIVACY.md`
- Güncelleme: `docs/UPDATE.md`
- SignPath: `docs/SIGNPATH.md`
