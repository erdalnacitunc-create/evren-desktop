# Güvenlik ve Kalite Denetimi

Tarih: 19 Ekim 2026  
Uygulama: EVREN Desktop 0.1.0 (Electron 44.9.0, Node 26)  
Kapsam: `src/main`, `src/preload`, `src/renderer`, bağımlılıklar, çalışma zamanı.

## Kullanılan araçlar / repolar

| Araç | Repo | Ne yapar |
|---|---|---|
| **electron-audit 0.1.11** | `gyugyu86/electron-audit` | Güncel Electron güvenlik statik analizi; veri akışı, CSP, IPC, `openExternal`, sandbox. |
| **Electronegativity 1.10.3** | `doyensec/electronegativity` | Klasik Electron güvenlik denetimi (bakımı durmuş; ikinci görüş). |
| **npm audit** | npm | Bilinen CVE'ler / bağımlılık zafiyetleri. |
| **license-checker** | `davglass/license-checker` | Lisans uyumu (MIT hedefi). |
| **depcheck** | `depcheck/depcheck` | Kullanılmayan/eksik bağımlılıklar. |
| **Playwright** | `microsoft/playwright` | Gerçek Electron uygulamasında E2E/duman testi. |

## Sonuç özeti

| Kontrol | Sonuç |
|---|---|
| electron-audit | **1 bulgu** (high, `heuristic`) — güvenli `openExternal` yardımcısında, manuel doğrulandı. |
| Electronegativity | **5 bulgu** — 3'ü araç kısıtı/yanlış pozitif, 2'si manuel doğrulandı. |
| npm audit (production) | **0 zafiyet** |
| npm audit (tümü) | 8 moderate — **yalnızca devDependencies** (electron-builder zinciri). |
| Lisanslar | MIT / ISC / BSD / Apache-2.0 / BlueOak; copyleft yok. |
| depcheck | Kullanılmayan bağımlılık yok. `@shared/types` alias'ı yanlış pozitif. |
| E2E (`npm run test:e2e`) | **Geçti** (sandbox + contextIsolation + preload + pano izni). |

## Yapılan düzeltmeler

1. **`sandbox: true`** — renderer artık OS sandbox içinde. `nodeIntegration: false`,
   `contextIsolation: true`, `webviewTag: false`.
2. **Güvenli `shell.openExternal`** — `src/main/safeOpen.ts`; yalnızca `http:`/`https:`
   şemaları açılır. 3 çağrı bu yardımcıya bağlandı.
3. **İzin politikası** — `session.setPermissionRequestHandler` ve
   `setPermissionCheckHandler` yalnızca `clipboard-sanitized-write` iznine izin verir;
   kamera/mikrofon/konum/bildirim/cihaz izinleri reddedilir.
4. **Gezinme kilidi** — `will-navigate` ve `will-attach-webview` engellendi;
   `setWindowOpenHandler` her yeni pencereyi reddeder.
5. **CSP sertleştirme** — `object-src 'none'`, `base-uri 'none'`,
   `frame-ancestors 'none'`, `form-action 'none'` eklendi. Üretimde
   `script-src 'self'`; satır içi script'in gerçekten engellendiği doğrulandı.
6. **`settings.json` BOM toleransı** — UTF-8 BOM'lu ayar dosyası artık doğru okunur.
7. **Çalışma alanı sınırı** — dosya araçları seçilen klasör dışına çıkamaz; `.git`
   korumalı; her değişiklik yedeklenir.

## Kalan bulgular ve değerlendirme

### electron-audit — EA040 (high, heuristic)
`src/main/safeOpen.ts:22` — `shell.openExternal(parsed.toString())`.
Araç, URL'nin dinamik olduğunu görüyor ancak hemen üstündeki
`parsed.protocol !== 'https:' && parsed.protocol !== 'http:'` kontrolünü veri akışına dahil etmiyor.
**Manuel doğrulama: güvenli.** Yalnızca http(s) geçer.

### Electronegativity
- **CSP_GLOBAL_CHECK (low, tentative):** CSP bir değişkende tanımlı olduğu için araç
  ayrıştıramıyor. CSP manuel doğrulandı ve sertleştirildi.
- **AUXCLICK_JS_CHECK (medium, firm):** `will-navigate` + `setWindowOpenHandler`
  ile yeni pencere/gezinme engellendi. Araç bu kapanışı görmüyor.
- **REMOTE_MODULE_JS_CHECK (medium, tentative):** Electron 44'te `remote` modülü
  kaldırıldı; `enableRemoteModule` kullanılmıyor.
- **PRELOAD_JS_CHECK (medium, firm):** Preload yalnızca dar `window.evren` API'si
  sunuyor; `require`/`process` renderer'da `undefined` (E2E ile doğrulandı).
- **OPEN_EXTERNAL_JS_CHECK (medium, tentative):** `safeOpen.ts` içindeki allowlist'li
  tek çağrı; manuel doğrulandı.

### npm audit — dev-only
`electron-builder` zincirindeki `sprintf-js` (GHSA-hp3w-g68c-fv3c, DoS) ve türevleri.
**Üretim paketine girmiyor** (devDependency). Packaging (M6) sırasında sürüm
güncellemesi yeniden değerlendirilmeli. `npm audit fix --force` önerilmez.

## Yeniden çalıştırma

```bash
npm run audit:security        # electron-audit (güncel)
npm run audit:security:legacy # Electronegativity (ikinci görüş)
npm run audit:deps            # üretim bağımlılıkları
npm run audit:licenses        # lisans özeti
npm run test:e2e              # gerçek Electron duman testi
```

`test:e2e` için `EVREN_API_KEY` veya `EVREN_LLM_API_KEY` ortam değişkeni gerekir;
test izole geçici veri dizini kullanır, kullanıcı verisine dokunmaz.

## Sıradaki güvenlik adımları (M6)

- **Kod imzalama** (Windows Authenticode) ve installer imzası.
- **Electron Fuses**: `RunAsNode` kapatma, `onlyLoadAppFromAsar`,
  `embeddedAsarIntegrityValidation`, `enableCookieEncryption`.
- **asar bütünlük doğrulaması** ve güncelleme imzası.
- Electron sürüm takibi (electron-audit EA062 / Dependabot).
- `run_command` için isteğe bağlı komut allowlist'i (şu an Onaylı mod önerilir).

## Ek denetim — 21 Ekim 2026 (beta)

Kapsam: temiz beta kaynak ağacı (`evren-desktop-beta`), Git geçmişi, bağımlılıklar
ve gerçek Electron E2E.

### Araçlar ve sonuçlar

| Araç | Sonuç |
|---|---|
| **Semgrep 1.182.0** (`p/typescript`, `p/security-audit`, `p/secrets`) | **0 bulgu** (Chat.tsx için 2 kural zaman aşımı) |
| **Gitleaks 8.30.1** | **0 sızıntı** (1 commit, ~1.43 MB) |
| **electron-audit 0.1.11** | 1 high heuristic (`safeOpen`), 1 low (imzalama) |
| **Electronegativity 1.10.3** | 5 bulgu; tamamı manuel incelemede yanlış pozitif |
| **npm audit --omit=dev** | **0 zafiyet** |
| **npm audit (tümü)** | 8 moderate, yalnızca dev `electron-builder` zinciri |
| **license-checker** | MIT/ISC/BSD/Apache/BlueOak; copyleft bağımlılık yok |
| **depcheck** | Yalnızca `@shared/*` alias yanlış pozitifleri |
| **knip** | Runtime entrypoint’ler ve bilinçli public tipler dışında ölü kod yok |
| **E2E (`npm run test:e2e`)** | **Geçti** (sandbox, contextIsolation, preload, pano) |
| **Temiz paket testi** | `win-unpacked` ayrı `%APPDATA%\EVREN Desktop Beta` ile onboarding açtı |

### Yapılan düzeltmeler

- **Tarball symlink/hardlink koruması:** `src/main/extensions/github.ts`
  içindeki çıkarma filtresi artık `SymbolicLink`, `Link` ve `linkpath` girdilerini
  reddediyor. Path traversal (`..`, absolute path) koruması korunuyor.
- Kullanılmayan `safeJoin` ve `setSubagentTaskStatus` kaldırıldı.
- `src/main/index.ts` biçimlendirmesi düzeltildi.
- Sürüm `0.1.1`e yükseltildi.

### Manuel doğrulanan yanlış pozitifler

- `safeOpen.ts`: `shell.openExternal` çağrısından önce yalnızca `http:`/`https:`
  protokolleri kabul ediliyor.
- Electronegativity: `BrowserWindow` için `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webviewTag: false`; navigasyon ve yeni pencere
  engelleri mevcut.
- CSP üretimde `script-src 'self'`.

### Kalan bilinçli riskler

- Windows installer **imzasız**; SmartScreen uyarısı gösterebilir.
- `electron-builder` dev zincirindeki moderate CVE'ler üretim paketine girmiyor.
- `run_command` ve terminal, kullanıcı onayı/eylemiyle keyfi yerel komut çalıştırır;
  tasarım gereği.
