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
# 0.4.6 Beta — ajan katmanı: limit, devretme, skill kataloğu

Hibrit mimarinin ilk üç aşaması. Çoklu Evren'e **dokunulmadı** (ayrı konuşma).

## 1. Alt ajan limiti: 6 + 6

0.4.5'e kadar alt ajan sayısı **sınırsızdı**. Model `spawn_agent`'ı kaç kez
çağırırsa o kadar koşu başlıyordu.

| Sınır | Değer | Davranış |
|---|---|---|
| Eşzamanlı | **6** | Kapasite dolunca yeni istek **kuyruğa** girer (FIFO) |
| İstek başına toplam | **6** | Aşılırsa **reddedilir** (bütçe, kuyruk değil) |
| Kuyruk zaman aşımı | 5 dk | Aşılırsa slot bütçeden geri verilir |
| Derinlik | 1 | Alt ajan alt ajan açamaz |

**Kuyruk ile bütçe neden ayrı:** bütçe aşımı modelin planlama hatasıdır
(sonsuz fan-out); kuyruk yalnızca zamanlama sorunudur. İkisini aynı şekilde
reddetmek, meşru paralel işi de cezalandırırdı.

Reddedilen istek modele açıklamayla döner:

```
İstek başına alt ajan bütçesi doldu. (kullanılan: 6/6, etkin: 2/6)
Elindeki sonuçlarla devam et; yeni alt ajan açma.
```

Yani model yeniden denemez, elindekiyle sentez yapar.

### Yinelenen görev koruması

Aynı görev iki kez başlatılamaz. Ancak düz metin benzerliği **yetmedi**:
modeller görevleri şablonla yazıyor ("X ile ilgili tüm dosyaları bul…"),
yalnızca `X` değişiyor. Düz Jaccard bunları %70+ benzer görüp reddediyordu —
canlı testte 8 istekten yalnızca **1** alt ajan çalıştı.

Çözüm **IDF ağırlıklı benzerlik**: şablon sözcükleri ("ilgili", "dosyaları",
"listele") düşük ağırlık alır, ayırt edici sözcük ("faturalama", "arama")
yüksek. Böylece şablon ortaklığı benzerliği şişirmez, gerçek tekrar yakalanır.

## 2. Alt ajanlar seçili modelde ve fiilen devrede

- Alt ajanlar **seçili model** üzerinden koşar (`payload.model`). Ayrı model
  seçimi yoktur; kullanıcı modeli değiştirirse alt ajanlar da değişir.
  Bu bir testle sabitlendi.
- **Asıl sorun kullanımdı:** 15 oturumda `spawn_agent` çağrısı **0**. Sistem
  istemi "karmaşık işleri devret" diyordu ama ne zaman/nasıl olduğunu
  söylemiyordu.

Sistem istemine açık devretme kuralları eklendi (Anthropic'in *"scale effort to
query complexity"* ilkesi):

| Durum | Kural |
|---|---|
| Çok dosyalı keşif ("nerede tanımlı", "tüm çağrı yerleri") | 2-4 `explore`, **paralel** |
| Kod incelemesi / risk taraması | `review` |
| Bağımsız çok adımlı uygulama | `general` |
| Tek dosya / tek komut / bilinen yer | **devretme** |
| Görev metni | hedef + dosya kalıbı + beklenen çıktı (belirsiz görev yasak) |

Ayrıca: "alt ajan sonucu bir **gözlem**dir; çelişki varsa aracı kendin
doğrula" — Cognition'ın örtük karar riskine karşı.

## 3. Skill kataloğu ve yönlendirici

Önce: tüm skill'lerin ad + açıklaması sistem istemine yazılıyor, üstelik
`skill` aracının açıklaması **aynı adları ikinci kez** tekrarlıyordu.

Şimdi:

| Katman | İçerik | Bütçe |
|---|---|---|
| Katalog (bağlamda) | ad + kısa açıklama + "ne zaman" | 6 000 token |
| Gövde (istek üzerine) | tam talimat | 4 000 token, aşılırsa kırpılır + not |

- Bütçe aşılırsa katalog kesilir ve modele **kaç becerinin listelenmediği**
  söylenir (sessiz kesme yok).
- **Yönlendirici**: görev metnine göre en uygun **3** skill işaretlenir
  ("bu göreve uygun"). Gövde yine otomatik yüklenmez; model `skill` aracıyla
  karar verir.
- Türkçe normalizasyon (büyük/küçük harf, `ı/ş/ğ/ü/ö/ç`) ve basit gövde kesme.
- Alt ajanlar da artık katalog alıyor (önceden hiç skill bilgisi yoktu).
- `skill` aracı gövdeyi 4 000 token'da kırpar; kırpıldığını modele söyler.

**Bulunan hata:** yönlendirici `usb`, `git`, `ipc` gibi **kısa ama kritik**
terimleri uzunluk filtresine takıp atıyordu → "usb aygıtlarını incele" sorgusu
0 sonuç döndürüyordu. Eşik 2 karaktere indirildi, yalnızca gerçek dolgu
sözcükleri (ve, ile, bir, için…) eleniyor.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `agent-subagent-limit-test` | 42 | Kuyruk, bütçe, iptal, zaman aşımı, FIFO, reset |
| `agent-skill-catalog-test` | 46 | Bütçe, vurgulama, puanlama, Türkçe, kırpma |
| `agent-subagent-e2e-test` | 11 | Gerçek döngü: 8 spawn → 6 çalışır, 2 reddedilir |
| `agent-topology-test` | 54 | Şablonlu ama farklı görevler artık reddedilmiyor |

Toplam: **53 paket / 1224 kontrol** (önceki: 50/1125). typecheck ✓ build ✓ e2e ✓

## Bilinçli olarak yapılmayanlar

- **Çoklu Evren entegrasyonu** — sizin isteğinizle sonraya bırakıldı.
  `planTopology()` hazır ama döngüye bağlanmadı.
- **Otomatik skill taslağı** — onay akışı ve karantina ile birlikte, sonraki
  aşama.
- **Triage'ın döngüye bağlanması** — önce alt ajan kullanımının gerçek
  verisini görmek gerekiyor.

## Sıradaki adım (ölçüm)

0.4.6'yı kurup birkaç çok dosyalı sorgu çalıştırın. Loglarda şunları
görmelisiniz:

```text
(agent/loop) Alt ajan reddedildi: … bütçesi doldu
(agent/loop) Skill kataloğu bütçeye kısıldı: N dahil, M dışarıda
```

Ve olay günlüğünde ilk kez `spawn_agent` çağrıları. Bu veri gelmeden triage
eşiklerini kalibre etmek anlamsız.
SignPath Foundation başvurusu Ekim 2026'da reddedildi; bu beta installer
imzasızdır. Windows SmartScreen “Bilinmeyen yayıncı” uyarısı gösterebilir.
İmzalama seçenekleri (yeniden başvuru veya ticari sertifika) ileride
değerlendirilecektir.

- Gizlilik: `PRIVACY.md`
- Güncelleme: `docs/UPDATE.md`
- SignPath: `docs/SIGNPATH.md`
