# EVREN Desktop — Geliştirme Planı

Windows için, EVREN LLM API'sini (OpenAI/Anthropic uyumlu) kullanan bir masaüstü
sohbet/agent istemcisi. Referanslar: **Claude Desktop** (UX), **OpenCode**
(client-server + sağlayıcı/config modeli + agentic araç kullanımı), ve açık
kaynak sohbet istemcileri (Chatbox / Cherry Studio / LobeChat).

## Hedef (MVP)
1. İlk açılışta kullanıcı, resmi sayfadan (`evren.ssyz.org.tr/api-keys`) aldığı
   API anahtarını girer.
2. Anahtar güvenli şekilde saklanır (Windows DPAPI / Electron safeStorage).
3. `GET /v1/models` ile anahtarın eriştiği modeller listelenir (task, modalite,
   fiyat, bağlam, yetenekler).
4. `POST /v1/chat/completions` ile **streaming** sohbet.
5. Markdown/kod bloğu render, kopyala, çoklu sohbet geçmişi (yerel).
6. Kota/kredi göstergesi (`GET /v1/quota`).
7. Ayarlar: base URL override, sıcaklık/top_p/max_tokens, reasoning_effort,
   thinking.
8. Windows kurulum paketi (NSIS) — x64.

## Mimari (öneri: Electron + React + TS)
- **Main process**: API anahtarı saklama, HTTPS istekleri, SSE streaming, IPC.
- **Renderer**: React + Vite + TypeScript + Tailwind; sohbet UI, model seçici, ayarlar.
- **preload**: dar, tip güvenli IPC köprüsü (contextIsolation açık).
- **storage**: Electron `safeStorage` (DPAPI) ile anahtar; ayarlar JSON.
- **api-client**: tek çekirdek + OpenAI ve Anthropic adaptörleri.

```
evren-desktop/
  docs/                 # keşif + plan (bu klasör)
  src/
    main/               # Electron main
    preload/
    renderer/           # React arayüz
    shared/             # tipler, sözleşme modelleri
  resources/
  tests/
```

## Tersine mühendislik görevleri (REA ile)
REA = `npx rea-agents` MCP; nötr/statik JS-Electron analizi ve tarayıcı gözlemi yapar.
- **Claude Desktop (Electron, proprietary):** yalnızca desen/UX çıkarımı — onboarding,
  anahtar saklama, IPC sınırı, streaming işleme. (Kod/asset kopyalanmaz.)
- **OpenCode desktop:** sağlayıcı/config UX'i ve agent akışı.
- **EVREN web SPA:** statik JS analizi ile istek gövdesi/header/SSE/hataların
  kesin biçimi.
- **Canlı yakalama:** `evren.ssyz.org.tr/llm/chat` trafiğinden auth header ve SSE
  delta şemasını teyit (HAR).

## Kilometre taşları
- **M0 Recon** ✅ (API sözleşmesi + klasör) — capture açık soruları için devam.
- **M1 Scaffold**: Electron+Vite+TS iskeleti, pencere, güvenli IPC.
- **M2 Anahtar + Modeller**: onboarding, safeStorage, `/v1/models` listesi.
- **M3 Sohbet (streaming)**: `/v1/chat/completions` SSE, markdown, iptal.
- **M4 Oturumlar**: çoklu sohbet, yerel geçmiş, arama.
- **M5 Ayarlar + Kota**: parametreler, `/v1/quota`, hata yönetimi.
- **M6 Paketleme**: electron-builder, NSIS, kod imzalama (opsiyonel).
- **M7 Cilalama**: tema, kısayollar, güncelleme, ek yetenekler (vision, tools).

## Yasal/etik
- Analiz, birlikte çalışabilirlik ve öğrenme amaçlıdır.
- Tescilli uygulamaların kodu/asset'i kopyalanmaz; yalnızca desen ve gözlem.
- EVREN API kullanımı, platformun şartlarına (kredi/CR, KVKK) tabidir.
