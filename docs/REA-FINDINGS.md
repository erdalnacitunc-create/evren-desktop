# REA Bulguları — Referans Uygulamalar (M0/M3)

Yöntem: REA statik JavaScript/Electron analizi (engine gerektirmez).
Hedefler yalnızca **davranış/özellik gözlemi** için incelendi; kod veya asset
kopyalanmadı (bkz. `docs/LEGAL.md`).

## Hedefler
| Uygulama | Kurulum | Sürüm | Biçim |
|---|---|---|---|
| Claude Desktop | `C:\Program Files\WindowsApps\Claude_2.19675.1.0_x64__pzs8sxrjxfjjc` | 2.19675.1.0 | MSIX + Electron (`app.asar`, 43 MB) |
| OpenCode Desktop | `%LOCALAPPDATA%\Programs\@opencodedesktop` | — | Electron (`app.asar`, 176 MB) |

## REA kanıtı (Claude, ana süreç girişi)
- `evidence_id`: `ev_aa6467c1c0774c7f57c99d3d059a97bd0a99e5675b5622ec0986797b77ff5c11`
- `predicate_type`: `rea.javascript-application-analysis`
- `confidence`: `derived`
- `root_artifact_sha256`: `ec8e905a7e7ba41ff41201efae496e9ee3b92d0cf4fb065282053e76e66d463b`
- `inventory_manifest_id`: `agm_f03327f5271919b80f81773db1c1ad7588b11419e2227fe68f50e3c2a3282312`
- Kapsam: `.vite/build/index.pre.js` (1.078.548 bayt, 245.152 AST düğümü, 187 bulgu)
- Sınırlama: 356 envanter dosyası analiz kapsamı dışında; ilişkiler kısmi.

> Not: 43 MB tam-uygulama analizi ve 176 MB OpenCode analizi `provider_timeout`
> verdi; bu yüzden hedefli `--source-path` kullanıldı. Derin ana-chunk analizi
> ayrıca çalıştırıldı.

## Gözlem: Claude Desktop özellik haritası (package.json'dan)
Bunlar **gözlem**dir (paketlenmiş bağımlılık adları), davranış iddiası değildir:

- **Agent / bilgisayar kullanımı:** `@anthropic-ai/claude-agent-sdk`, `@ant/computer-use-mcp`, `@ant/session-halo-helper`
- **Tarayıcı entegrasyonu:** `@ant/claude-for-chrome-mcp`, `playwright-core`, `claude-browser-shim.js`
- **Uzak erişim:** `@ant/claude-ssh`, `ssh2`, `claude-ssh-broker.exe`, `claude-ssh-proxy.exe`, `claude-ssh-askpass.exe`
- **Uzak masaüstü:** `@ant/rfb-client` (RFB/VNC istemcisi)
- **Cowork (yerel servis):** `@ant/cowork-win32-service`, `cowork-svc.exe`, `smol-bin.x64.vhdx`
- **MCP / eklenti:** `@modelcontextprotocol/sdk`, `@anthropic-ai/mcpb`, `@ant/dxt-registry`, `@ant/managed-config`
- **Görsel üretim:** `@ant/imagine-server`
- **Terminal:** `node-pty`
- **Altyapı:** `electron-store`, `conf`, `electron-window-state`, `@sentry/electron`, `zod`, `winston`
- **Paketleme:** Electron Forge + Vite (`@electron-forge/plugin-vite`), MSIX maker

## Çıkarım: EVREN Desktop için uyarlanabilir desenler
Aşağıdakiler **tasarım önerisi**dir; referans ürünlerin kodu kullanılmaz:

1. **Çoklu sağlayıcı/model seçici** — bizde `/v1/models` + `task`/`capabilities` ile dinamik.
2. **Yerel ayar/anahtar saklama** — `electron-store` benzeri; bizde Windows DPAPI.
3. **MCP bağlayıcıları** — EVREN `evren_tools` destekliyorsa araç çalıştırma.
4. **Terminal / dosya erişimi** — `node-pty` benzeri; agentic modda.
5. **Çoklu oturum + pencere durumu** — sohbet geçmişi ve pencere konumu kalıcılığı.
6. **Uzantı kaydı (DXT/MCP)** — model/araç eklentileri için manifest tabanlı kayıt.
7. **Güvenlik** — contextIsolation, dar IPC, anahtarın renderer'a sızmaması (bizde uygulandı).

## REA kanıtı (Claude, ana chunk — derin analiz)
- `evidence_id`: `ev_9687cdad2b5874fac2b891ad3f0213162fd1780d9beed576a75c156c893af2bc`
- Dosya: `.vite/build/index.chunk-DVtu79Rf.js` (7.075.750 bayt)
- `1.721.733` AST düğümü, `617` bulgu, `6` modül
- Grafik: `922` düğüm, `1331` kenar
- Düğüm türleri: 11 `browser-window`, 3 `ipc-handler`, 3 `ipc-channel`,
  2 `electron-utility`, 4 `native-addon`, 1 `electron-renderer`, 123 `endpoint`

### Gözlem: pencere mimarisi
Çoklu pencere deseni: `main_window`, `quick_window`, `about_window`,
`buddy_window`, `design_window` (ayrı renderer bundle'ları).

### Gözlem: IPC
- `main:on:electron-store-get-data`
- `main:handle:Co.RequestOpenMcpSettings`
- `main:handle:e` (dinamik/minified)
- `mcp-session-id` bağlantı adı

### Gözlem: MCP yapılandırma şeması (literal dizeler)
`managedMcpServers[]` için: `transport` (`builtin` dahil), `scopes`,
`oauth.scopes`, `authorityHost`, `source`, `toolPolicy: "ask-session"`,
`orgPluginSettings[].tools[].permission: "ask-session"`.

### Gözlem: kurumsal çıkarım ağ geçidi
- `inferenceGatewayOidc`, `inferenceGatewayOidcAuthFlow`
- `inferenceGatewayAuthScheme: "sso" | "auto"`
- `inferenceCredentialKind: "oauth" (Vertex AI)`

→ Yani Claude Desktop, **kurumsal SSO/OAuth tabanlı çıkarım ağ geçidini**
destekliyor. EVREN Desktop için doğrudan bir desen: API anahtarı + kurumsal SSO.

### Gözlem: diğer yüzeyler
- `buddy_window` + `clawdQuestEngine` (oyunlaştırma/yan karakter)
- `designWindow`, `quickWindow`, `quickWindowPosition`
- `windowsUpdates`, `/api/v2/rum`, `/s2/favicons`, `mint`
- Kabuk yolları: `/bin/zsh`, `/usr/bin/pgrep`, `/usr/bin/log`, `/usr/sbin/kextstat`
- `node-pty` (terminal), `node-pty/lib/windowsPtyAgent.js`

## Bilinmeyenler
- Claude'un IPC kanal adları ve renderer API yüzeyi (ana giriş dosyasında bulunmadı;
  ana chunk analizi sürüyor).
- Özelliklerin gerçek çalışma zamanı davranışı (statik analiz çalıştırma gözlemi değildir).
- EVREN'in `evren_tools` / araç çağırma sözleşmesinin ayrıntıları (canlı test gerekir).

## Ghidra
Ghidra kurulu; gerekirse native hedefler (`claude.exe`, `opencode-cli.exe`) REA'nın
Ghidra sağlayıcısıyla incelenebilir. JS/Electron analizi için gerekmez.
