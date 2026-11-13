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
# 0.4.11 Beta — çalışma alanı dışı yollar ve Türkçe sınır hatası

0.4.10'daki plc_proje koşunuzu inceledim. **Sonuç en iyisiydi**, ama bir kusur
çıktı.

## Koşu sonuçları: en hızlı ve en temiz

| Sürüm | Süre | Retry | Araç | Alt ajan | Rapor |
|---|---|---|---|---|---|
| 0.4.7 | 21 dk | 4 | 15 | 4 (hepsi boş) | 10 080 kr |
| 0.4.8 | 13 dk | 11 | 12 | 4 (hepsi kısmi) | 6 827 kr |
| **0.4.10** | **5,6 dk** | **0** | **8** | 0 | 3 827 kr |

**%73 daha hızlı, sıfır retry.** Model bu kez alt ajan kullanmadı ve doğru
kararı verdi: 8 `run_command` ile yapıyı çıkardı, 5,6 dakikada bitirdi.
Devretmek bu iş için gereksizdi.

Rapor kalitesi de arttı — model neyi **doğrulamadığını** açıkça yazdı:

> **Doğrulanamayanlar (içerik okuması yapılmadı)**
> Bu özet dizin yapısı, dosya adları, boyutlar, git geçmişi ve dal adları
> üzerinden çıkarıldı. Şunlar içerikten teyit edilmedi: firmware'de gömülü
> Wi-Fi/MQTT/API kimlik bilgisi olup olmadığı, `araclar/.env_ornek` içeriği,
> `supabase/migrations` şema detayları…

Ve devamında alt ajanı **kendisi önerdi**:

> "İstersen bir sonraki adımda sır taraması, veri şeması çıkarımı ve Flutter
> bağımlılık gruplarını **paralel alt ajanlarla** içerikten doğrulayabilirim."

Yani 0.4.5–0.4.9 arası yaptığımız devretme kuralları modele işlemiş.

## Kusur: çalışma alanı dışındaki yollar

Model bir kez `read_file` denedi ve hata aldı:

```
Araç hatası: ENOENT: no such file or directory, stat
'C:\Users\erdal\AppData\Local\Temp\evren-workspaces\mwekjvxv-5e451733\00_genel_felsefe.md'
```

Sebep: çalışma alanı **geçici klasördü**, kullanıcı ise masaüstündeki
`plc_proje` klasörünü sordu. `read_file` göreli yolu çalışma alanına göre çözer
ve **kapsam dışına çıkamaz** (path traversal koruması — bilinçli).

Model PowerShell'e düşüp devam etti. Kayıp: 1 adım + dağınık çıktı. Daha
önemlisi: model bunu **bilmiyordu**, deneyerek öğrendi.

### Düzeltme 1: istem baştan söylüyor

Kullanıcı metninde çalışma alanı dışı bir yol geçiyorsa (sürücü harfi,
`/home/...`, "masaüstü", "belgeler", "indirilenler"…) sistem istemine eklenir:

```
ÇALIŞMA ALANI DIŞI: Kullanıcı çalışma alanı dışında bir yol söyledi.
read_file, list_files, glob, grep ve write_file yalnızca çalışma alanı içinde
çalışır (kapsam dışına erişim güvenlik gereği engellenir).
Çalışma alanı dışındaki dosyaları okumak için run_command kullan ve mutlak yol
ver. Örnek: Get-Content "C:\proje\README.md" -Encoding UTF8.
read_file denemeyin; doğrudan run_command ile ilerleyin.
```

Alt ajanlar için aynı not, görev metninde mutlak yol varsa eklenir.

### Düzeltme 2: hata mesajı eyleme dönük

Önce: `Çalışma alanı dışına erişim engellendi.`
Sonra:
```
Çalışma alanı dışına erişim engellendi. Çalışma alanı dışındaki dosyalar için
run_command + mutlak yol kullan (ör. Get-Content "C:\proje\dosya.md").
```

Böylece model hatayı görünce ne yapacağını biliyor — deneme yanılma yok.

## Yan bulgu: Türkçe `\b` tuzağı tekrar çıktı

Yol tespiti ilk yazdığımda `\bmasaüstü\b` kullandım. **"masaüstü" ile biten
metinde eşleşmedi** — çünkü `ü` JavaScript'te kelime karakteri değil, dolayısıyla
sonda sözcük sınırı oluşmuyor.

Bu tuzağı 0.4.2'de hafıza sınıflandırıcısında yaşamıştık; aynı hata başka bir
modülde tekrar etti. Çözüm: Türkçe sözcüklerde `\b` yerine **kök eşleşmesi**
(`masaüst`, `belge`, `indirilen`) — çekim eklerini de yakalar.

## Google araması sorusuna cevap

**Şu an Google kullanılmıyor.** Kod Google CSE'yi destekliyor ama iki anahtar
gerekiyor ve bunlar tanımlı değil:

```
GOOGLE_CSE_API_KEY: YOK
GOOGLE_CSE_ID:      YOK
etkin zincir:       duckduckgo → bing
gerçek arama:       Arama (DuckDuckGo): "OpenSSL 3.5 release notes" · 5 sonuç
```

Tanımlanırsa zincir otomatik `google → duckduckgo → bing` olur. Anahtarlar
şu an **yalnızca ortam değişkeni** olarak okunuyor; arayüzde alan yok ve
uygulama ortam değişkenlerini kendi başlatmıyor. Bu bir sonraki adım olabilir
(ayarlar ekranına "Google Custom Search" alanı).

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `outside-workspace-hint-test` | 19 | Yol tespiti, Türkçe kök eşleşmesi, metin kalitesi |

Toplam: **60 paket / 1407 kontrol** (önceki 59/1388). typecheck ✓ build ✓ e2e ✓

## Sizin bir sonraki sınamanız

0.4.11'de aynı sorgu şunu yapmalı:

1. `read_file` denemeden doğrudan `run_command` + mutlak yol
2. Aynı hız (5-6 dk) veya daha iyi
3. Kayıp adım olmaması

İsterseniz ikinci adımda modelin önerdiği üçlüyü çalıştırın — sır taraması,
şema çıkarımı, Flutter bağımlılıkları — bu kez alt ajanlar gerçekten iş
yapacak ve 0.4.6–0.4.9 zincirini uçtan uca sınamış oluruz.
SignPath Foundation başvurusu Ekim 2026'da reddedildi; bu beta installer
imzasızdır. Windows SmartScreen “Bilinmeyen yayıncı” uyarısı gösterebilir.
İmzalama seçenekleri (yeniden başvuru veya ticari sertifika) ileride
değerlendirilecektir.

- Gizlilik: `PRIVACY.md`
- Güncelleme: `docs/UPDATE.md`
- SignPath: `docs/SIGNPATH.md`
