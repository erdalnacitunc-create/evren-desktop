# Uzantı Sistemi — Araştırma ve Tasarım (Kod Öncesi)

Tarih: 2026-10-19
Durum: **Tartışma aşaması** — kod yazılmadı.

## 1. Amaç
Ayarlar > **Uzantılar** sekmesi (MCP'ler / Eklentiler / Beceriler) ve kullanıcının
GitHub repo adresini yapıştırıp uzantı ekleyebildiği bir mekanizma.

## 2. Araştırma özeti

### 2.1 OpenCode V2 modeli
Üç ayrı uzantı türü var:
- **MCP sunucuları** (`mcp.servers`): `local` (stdio komutu) veya `remote` (Streamable HTTP).
  OAuth, header, timeout, `disabled`, `codemode` desteklenir. Global veya proje kapsamı.
- **Eklentiler** (`plugins`): npm paketi, yerel dizin/dosya veya **GitHub spec**
  (`github:acme/plugin`, `git+ssh://...#main`, `::path:` alt dizin). CLI:
  `opencode plugin add|list|check|update|remove`.
- **Beceriler** (`skills`): `SKILL.md` + `references/` + `scripts/`. Frontmatter
  (`name`, `description`, `metadata.opencode/autoinvoke`). Global/proje kaynakları,
  HTTP katalogları (`index.json`). Model `skill` aracıyla yükler.

Kapsam: global (`~/.config/opencode/...`) ve proje (`.opencode/...`). Ekran
görüntüsündeki "Tüm projelerde kullanılabilir" global kapsamı anlatır.

### 2.2 Claude Desktop Extensions / MCPB
- `.mcpb` = ZIP + `manifest.json` (eski adı `.dxt`).
- Manifest: `name`, `version`, `author`, `server` (`node`/`python`/`binary`/`uv`),
  `entry_point`, `mcp_config` (command/args/env), `user_config` (API anahtarı,
  dizin, sayı), `tools`, `prompts`, `compatibility`, `license`.
- `${__dirname}`, `${user_config.key}`, `${HOME}` gibi şablon değişkenleri.
- Hassas değerler **OS anahtar kasasında**; tek tıkla kurulum; otomatik güncelleme.
- Kurumsal: Group Policy/MDM, önceden onaylı uzantılar, blocklist, dizin kapatma.
- Açık kaynak: `modelcontextprotocol/mcpb` (Apache-2.0/MIT).

### 2.3 GitHub'dan kurulum desenleri
- **Pinleme:** tarball'ı belirli commit SHA'sından indir (`codeload.github.com/.../tar.gz/<sha>`).
- **Tarama:** GitHub API ile metadata (lisans, yıldız, son commit); anonim API 60 istek/saat,
  token ile 5000/saat.
- **Manifest tespiti:** `manifest.json`, `package.json`, `SKILL.md`, `mcp.json`.
- **Önizleme + rıza:** ne çalışacak, hangi izinler, hangi lisans.
- **Kilit dosyası:** kaynak URL + ref + commit SHA + checksum + lisans.

## 3. Önerilen model

### 3.1 Uzantı birimi (unit)
Bir repo **birden çok** birim içerebilir. Örnek: `morluto/rea`
- Beceri: `.agents/skills/reverse-engineer-anything/SKILL.md`
- MCP: `package.json` → `rea-agents`, çalıştırma `npx -y rea-agents`

Tespit matrisi:
| İşaret | Birim |
|---|---|
| `manifest.json` + `mcpb_version` | MCPB paketi |
| `package.json` (`bin`, `keywords` içinde mcp/opencode/evren) | MCP veya Eklenti |
| `SKILL.md` (kök veya `skills/*/SKILL.md`) | Beceri |
| `mcp.json` / README'de `npx`/`uvx` komutu | MCP (öneri) |
| `.opencode/plugins/*` | Eklenti |

### 3.2 Kapsam
- `global`: tüm sohbetlerde.
- `workspace`: belirli bir çalışma dizini (ileride "proje" kavramı).
- MVP: **global**; veri modeli `scope` alanını baştan taşır.

### 3.3 Depolama
```
%APPDATA%/evren-desktop/
  extensions/
    mcp/<owner>-<repo>-<sha>/
    plugins/<owner>-<repo>-<sha>/
    skills/<owner>-<repo>-<sha>/
  extensions.json        # kayıt defteri (etkin/pasif, kapsam, ayarlar)
  extensions.lock.json   # kaynak, ref, sha, checksum, lisans
```

### 3.4 Kurulum akışı
1. Kullanıcı GitHub URL'sini yapıştırır (`#ref` ve `::path:` desteklenir).
2. Uygulama repo'yu inceler (API + manifest okuma), **birimleri** listeler.
3. Önizleme: tür, çalışacak komut, izinler, lisans, commit, boyut.
4. Kullanıcı birimleri seçer → **Kur**.
5. Tarball indirilir, SHA doğrulanır, çıkarılır, kilit dosyasına yazılır.
6. Uzantı etkinleştirilir; MCP ise bağlantı durumu gösterilir.

### 3.5 Güncelleme
- Manuel kontrol ("Güncelleme var" rozeti) → önizleme → onay.
- Tam commit SHA'ya pin; otomatik sessiz güncelleme **yok** (savunma bağlamı).
- Önceki sürüm geri alınabilir.

## 4. Güvenlik modeli

### 4.1 Tehditler
- Kötü niyetli repo → keyfi kod çalıştırma.
- Supply-chain: tag/SHA değişimi, sahte repo, tarball manipülasyonu.
- Gizli veri sızıntısı (ekran, dosya, anahtar).
- Aşırı izinli MCP/eklenti.

### 4.2 Kontroller
- **Sessiz çalıştırma yok:** kurulum ve ilk çalıştırma açık rıza ile.
- **SHA pin + checksum**; tarball doğrulama.
- **İzin özeti:** ağ, dosya, kabuk, sırlar; varsayılan en az yetki.
- **MCP:** ayrı alt süreç, kısıtlı ortam değişkenleri, timeout.
- **Eklenti (JS):** ana süreçte çalıştırmak riskli → ayrı utility process + dar RPC.
  Bu yüzden MVP'de **ertelenmesi** önerilir.
- **Lisans uyarısı:** GPL/AGPL'de uyarı; lisansı göster.
- **Denetim günlüğü:** kurulum/güncelleme/çalıştırma.
- **Kurumsal:** allowlist/blocklist, kapalı mod, özel dizin.

### 4.3 Savunma bağlamı
- Varsayılan: onaylı kurulum, manuel güncelleme, telemetri yok.
- Global kapsam için ek onay.
- Tam otomatik mod yalnızca kullanıcı açıkça seçerse.

## 5. Arayüz
- Ayarlar > **Uzantılar**
  - Başlık + açıklama
  - Sekmeler: **MCP'ler · Eklentiler · Beceriler**
  - `Tüm projelerde kullanılabilir` bölümü (global)
  - Her sekmede: **GitHub'dan ekle** kutusu + kurulu liste
- Liste öğesi: ad, kaynak (`owner/repo`), sürüm/commit, durum (Bağlı/Hata/Pasif/
  Güncelleme var), kapsam, izin özeti, etkinleştir/pasifleştir, kaldır.
- Ekleme diyaloğu: URL → İncele → birim seçimi → Önizleme → Kur.

## 6. Yol haritası (öneri)
- **E1:** Uzantılar UI + kayıt defteri + GitHub inspect/detect + **Beceri** kurulumu.
- **E2:** **MCP** kurulumu + stdio/HTTP istemcisi + araç entegrasyonu + onaylar.
- **E3:** **Eklenti** çalıştırma (izole süreç + RPC) — deneysel.
- **E4:** Güncelleme, kapsam, kurumsal kontroller, imzalı manifest.

## 7. Kararlar (2026-10-19)
- **Kapsam:** ilk sürümde **üç tür de** desteklenecek (Beceri + MCP + Eklenti).
- **Eklenti çalıştırma:** **izole utility process + dar RPC** (ana süreçte çalıştırma yok).
- **Kapsam modeli:** **global-only**; veri modelinde `scope` alanı korunur.
- **Güncelleme:** **bildir + onayla** (sessiz otomatik güncelleme yok).
- **Uygulama sırası:** E1 iskelet + Beceri → E2 MCP → E3 Eklenti.
  Üçü de ilk sürümde olacak; güvenli olan önce gelir.

## 9. Uygulama durumu
- **E1 tamamlandı (2026-10-19):**
  - Ayarlar > Uzantılar (Genel / Uzantılar sekmeleri)
  - MCP'ler / Eklentiler / Beceriler alt sekmeleri
  - GitHub URL inceleme (API + tarball + SHA pinleme)
  - Beceri tespiti ve kurulumu (`.agents/skills`, `.opencode/skills`,
    `.claude/skills`, kök `SKILL.md`)
  - Kurulu becerilerin listelenmesi, etkinleştirilmesi, kaldırılması
  - `skill` aracı ile ajana entegrasyon + sistem isteminde listeleme
  - Opsiyonel GitHub token (DPAPI)
  - MCP/eklenti tespiti gösterilir; kurulum E2/E3'te açılacak
  - **Kurulum ajan gerektirmez.** Kurulu beceriler, araçlar etkinken (varsayılan)
    tüm sohbetlerde modele otomatik sunulur.
  - Sağ tık menüsü: Geri Al / Yinele / Kes / Kopyala / Yapıştır / Tümünü Seç
    + bağlantı ve resim seçenekleri.
- **Kanıt:** `morluto/rea` → 5 beceri + 1 MCP tespit edildi; 
  `reverse-engineer-anything` kuruldu, yüklendi (23.510 karakter), kaldırıldı.
- **E2 tamamlandı (2026-10-19):**
  - MCP kurulumu (npm tabanlı `npx` ve paketlenmiş Node manifestleri)
  - stdio istemcisi (Streamable HTTP yolu hazır; OAuth henüz yok)
  - Araç entegrasyonu: doğrudan araçlar veya 100+ araçta meta-araçlar
    (`list_tools`, `describe_tool`, `call`)
  - Bağlantı durumu + Bağlan/Kes + hata gösterimi
  - Kurulum önizlemesinde **düzenlenebilir çalıştırma komutu**
  - **Kurulu MCP'yi sonradan düzenleme** (yerel komut/argüman/cwd/env veya uzak URL/başlıklar)
  - **Kanıt:** `morluto/rea` → `npx -y rea-agents --mcp`; 207 araç bağlandı;
    meta-araç listesi 53 KB, tek araç şeması 1.4 KB.
  - **Uzak HTTP kanıtı:** `https://mcp.deepwiki.com/mcp` → bağlı, 3 araç.
  - **OAuth:** loopback callback sunucusu + sistem tarayıcısı + `finishAuth` +
    DPAPI ile şifreli token/verifier saklama + token yenileme + "OAuth'u sıfırla".
    Kanıt: `oauth_store_token=true`, `oauth_cleared=true`,
    `oauth_callback_code=abc123`.
- **E2 sınırlamaları:** paketlenmiş Node dışı (Python/binary) MCP'ler desteklenmiyor.
  Gerçek bir OAuth sağlayıcısıyla uçtan uca giriş manuel test gerektirir
  (örn. Sentry/Linear); depo ve callback mekaniği otomatik doğrulandı.
- **E3 tamamlandı (2026-10-19):**
  - `evren.extension.json` / `package.json#evren` manifesti
  - İzole **Electron utilityProcess** + `vm` bağlamı
  - `registerTool`, `log`, `fetch` (host allowlist), `storage` (1 MB)
  - `require` / `fs` / `net` / `electron` erişimi yok
  - Araçlar ajana `plugin_<ad>_<araç>` olarak bağlanır; onay akışına tabidir
  - 30+ araçta sunucu/eklenti başına **meta-araçlar** (`list_tools`,
    `describe_tool`, `call`) ile 128 araç sınırı korunur
  - Yükle/Kaldır + durum + araç sayısı
  - Örnek: `examples/hello-plugin`; format: `docs/PLUGIN-FORMAT.md`
  - **Kanıt:** `plugin_state=loaded tools=4`, `echo`, `storage=stored:42`,
    `require_blocked=true`, `network_denied=true`.
- **E3 sınırlamaları:** yalnızca CJS ve bağımsız (harici npm bağımlılığı yok);
  UI/hook/komut API'si henüz yok; `vm` sert güvenlik sınırı değildir.
- **M6 paketleme notu:** `resources/plugin-host.cjs` ve
  `resources/computer-helper.ps1` `extraResources` ile pakete girmeli.

## 8. Eklenti izolasyon tasarımı (E3)
- Her eklenti kendi **Electron utility process**'inde çalışır (`utilityProcess.fork`).
- Ana süreç ile iletişim **MessagePort/RPC** üzerinden; eklenti doğrudan `fs`/`net`/`electron` görmez.
- Eklenti API'si (bizim): `@evren/plugin`
  - `registerTool({ name, schema, execute })`
  - `registerCommand({ name, execute })`
  - `hook('message'|'request'|'response', fn)`
  - `storage.get/set` (izinli, ad alanına kısıtlı)
- **İzin manifesti:** `evren.extension.json`
  - `permissions.network` (host listesi), `permissions.filesystem` (dizin listesi),
    `permissions.shell` (bool), `permissions.secrets` (anahtar adları)
- İzinler çalışma zamanında proxy ile uygulanır; izin yoksa çağrı reddedilir.
- Eklenti başına kaynak limiti (bellek/CPU) ve zaman aşımı.
- Çökme izolasyonu: bir eklenti çökerse uygulama etkilenmez.
- OpenCode eklenti API'si ile **birebir uyum hedeflenmez**; kendi API'miz.
  Gerekirse ileride adaptör yazılır.

