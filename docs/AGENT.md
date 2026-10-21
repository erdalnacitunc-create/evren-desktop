# Ajan Mimarisi (N1–N3)

EVREN Desktop'ın deneysel ajan katmanı. Referans uygulamalardan yalnızca **desen**
alınmıştır; kod kopyalanmamıştır (bkz. `docs/LEGAL.md`).

## Akış
1. Renderer `agent` seçenekleriyle `chat:start` çağırır.
2. Main, modele `tools` + `tool_choice: "auto"` ile istek atar.
3. SSE yanıtındaki `delta.tool_calls` parçaları biriktirilir (`src/main/sse.ts`).
4. Araç çağrıları yürütülür (`src/main/agent/loop.ts`).
5. Onaylı modda her çağrı için renderer'a `approval` olayı gider.
6. Araç sonucu `role: "tool"` mesajı olarak eklenir; model tekrar çağrılır.
7. Tool çağrısı kalmayınca `done` gönderilir.

## Araçlar
### MCP (E2)
- Kurulu ve etkin MCP sunucuları ajana araç olarak bağlanır.
- SUNUCU_ADI/ARAÇ_ADI biçiminde isimlendirilir.
- Toplam MCP aracı **100'ü aşarsa** doğrudan araçlar yerine sunucu başına iki
  **meta-araç** sunulur: `mcp_<sunucu>_list_tools` ve `mcp_<sunucu>_call`.
  Bu, EVREN API'sinin 128 araç sınırını aşmamak içindir.
- Tüm MCP çağrıları mevcut onay akışından geçer (Onaylı modda kullanıcı onayı).
- Bağlantı durumu Uzantılar > MCP'ler sekmesinde gösterilir; Bağlan/Kes vardır.
- stdio ve Streamable HTTP desteklenir; **uzak HTTP test edildi** (DeepWiki, 3 araç).
- **OAuth desteklenir:** loopback callback + sistem tarayıcısı + DPAPI token saklama;
  "OAuth'u sıfırla" ile oturum temizlenebilir.
- Kurulu MCP'nin komutu/URL'si arayüzden düzenlenebilir (MCP'ler > Düzenle).

### Eklentiler (E3)
- Eklenti araçları `plugin_<eklenti>_<araç>` olarak ajana bağlanır.
- Eklenti kodu ayrı `utilityProcess` + `vm` bağlamında çalışır; `require`,
  `fs`, `net`, `electron` erişimi yoktur.
- Yalnızca `registerTool`, `log`, izinli `fetch` ve eklentiye özel `storage`.
- Tüm eklenti araç çağrıları onay akışından geçer.
- 30+ eklenti aracında meta-araçlar kullanılır (`list_tools`, `describe_tool`, `call`).
- Format: `docs/PLUGIN-FORMAT.md` · örnek: `examples/hello-plugin`.

### Beceriler
Kurulu ve etkin beceriler ajana `skill` aracıyla sunulur; sistem isteminde
ad + kimlik + açıklama olarak listelenir. Model, talimatları yüklemek için
`skill { id }` çağırır. Beceri dosyaları `%APPDATA%/evren-desktop/extensions/skills/`
altında tutulur.

### Tarayıcı (`src/main/agent/browser.ts`)
Playwright + **sistemdeki Edge** (`channel: "msedge"`). Chromium gömülmez.
- `browser_open {url}`
- `browser_snapshot`
- `browser_click {ref|text|selector}`
- `browser_type {ref|selector, text, submit}`
- `browser_key {keys}`
- `browser_screenshot`
- `browser_close` (ajan bitince otomatik)

Snapshot, etkileşimli öğelere `data-evren-ref` atar ve modele `ref` numarası verir.
Böylece koordinat tahmini yerine DOM tabanlı güvenilir tıklama yapılır.

### Bilgisayar (`src/main/agent/computer.ts` + `resources/computer-helper.ps1`)
Deneysel. PowerShell + Win32 P/Invoke; ek npm native bağımlılığı yok.
- `computer_screenshot`
- `computer_click {x, y, button, count}`
- `computer_move {x, y}`
- `computer_type {text}` (pano üzerinden yapıştırır)
- `computer_key {keys}` (`CTRL+S` → `^S`)
- `computer_scroll {amount}`

Ekran görüntüsü PNG'ye alınır, base64 data URL olarak modele verilir.

## Modlar
- **Onaylı (varsayılan):** her araç çağrısı öncesi kullanıcı onayı.
- **Otomatik:** onay istenmez; üstte kırmızı uyarı bandı ve "Hemen durdur" görünür.
- **Varsayılan durum:** Ajan, araç destekleyen modellerde **otomatik olarak açıktır**.
  Kullanıcı isterse "Ajan" düğmesiyle kapatır. Uzantı kurmak için ajanın açık
  olması gerekmez; kurulum Ayarlar > Uzantılar'dan yapılır.

## Sınırlar ve güvenlik
- Maksimum **12 adım**, **25 araç çağrısı**.
- `chat:abort` bekleyen onayları reddeder; `before-quit` tüm ajanları durdurur.
- Bilgisayar araçları varsayılan **kapalı**; kullanıcı açar.
- Tehlikeli kabuk/dosya araçları yok.
- Her çağrı ve sonuç arayüzde kart olarak görünür (denetlenebilirlik).
- Ekran görüntüleri yalnızca seçili sağlayıcıya gönderilir; yerelde saklanmaz.

## Bilinen sınırlamalar
- Araç adımları oturum geçmişine **kalıcı yazılmaz**; yalnızca nihai metin kaydedilir.
- Önceki turların tool sonuçları yeni tura taşınmaz.
- `computer_type` pano kullanır (pano geçici olarak değişir, sonra geri yüklenir).
- Koordinatlar tam ekran pikselidir; çoklu monitörde sanal ekran kullanılır.
- Tarayıcı aracı sistemde Edge gerektirir.

## Test
- `EVREN_SELFTEST_AGENT=1`: başsız Edge ile gerçek araç çağrısı.
- `EVREN_SELFTEST_COMPUTER=1`: ekran görüntüsü, imleç, tuş eşleme, onay akışı.
- `EVREN_BROWSER_HEADLESS=1`: tarayıcıyı başsız çalıştırır.
