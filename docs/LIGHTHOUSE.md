# Lighthouse denetimi

EVREN Desktop, bir web sayfasının kalitesini ölçmek için uygulama içinden Lighthouse
çalıştırabilir. Denetim ajan aracı olarak sunulur: sohbette "bu sayfayı denetle"
dediğinizde model `lighthouse_audit` aracını çağırır.

## Araç

```text
lighthouse_audit
  url          zorunlu · http(s)
  categories   isteğe bağlı · performance | accessibility | best-practices | seo
  form_factor  isteğe bağlı · mobile (varsayılan) | desktop
  save_report  isteğe bağlı · true ise ham JSON <çalışma alanı>/.evren altına yazılır
```

Kategori: `browser` — bu yüzden **Bilgisayar/Tarayıcı araçları** açık olmalı ve izin
politikası `browser` kategorisine göre uygulanır (varsayılan: onaylı modda sorar).

## Nasıl çalışır

1. Adres doğrulanır — yalnızca `http:` ve `https:` kabul edilir; `file:`, `data:`,
   `javascript:` ve diğer protokoller reddedilir.
2. `chrome-launcher` sistemdeki Chrome'u başsız (headless) modda açar. Chrome yoksa
   araç hata döner; Edge/Chromium yolu `CHROME_PATH` ortam değişkeniyle verilebilir.
3. Lighthouse 13 denetimi çalıştırır (`output: 'json'`, `logLevel: 'error'`).
4. Sonuç özetlenir: kategori puanları (0-100), en kötü puanlı denetimler önce olacak
   şekilde sıralı liste, çalışma uyarıları.
5. Chrome her durumda kapatılır (`finally`), süreç sızıntısı olmaz.

Zaman aşımı varsayılan **120 saniye** (30 sn – 10 dk arasında ayarlanabilir).

## Çıktı

Ajan yanıtında Markdown özeti döner:

```text
# Lighthouse — https://example.com/
Denetim: 2026-10-31T10:00:00.000Z

| Kategori | Puan |
| --- | --- |
| Performans | 82 |
| Erişilebilirlik | 95 |
| En iyi uygulamalar | 100 |
| SEO | 90 |

## Öne çıkan denetimler
- **0** · Kontrast (—)
- **30** · TBT (810 ms)
...
```

`save_report: true` verilirse ham LHR JSON'u `.evren/lighthouse-<zaman>.json` olarak
yazılır; tam denetim ağacı burada bulunur.

## Kod

| Dosya | İçerik |
|---|---|
| `src/main/lighthouse.ts` | `normalizeAuditUrl`, `scoreToPercent`, `summarizeLighthouse`, `lighthouseMarkdown`, `runLighthouseAudit` |
| `src/main/agent/tools.ts` | `lighthouse_audit` aracı |
| `src/shared/types.ts` | `LighthouseSummary`, `LighthouseAudit`, `LighthouseReport` |

Özetleme ve Markdown üretimi saf fonksiyonlardır; ağ veya Chrome gerektirmez, bu
yüzden birim testlerle doğrulanır.

## Testler

```bash
# saf mantık (hızlı)
node scripts/run-unit.cjs scripts/lighthouse-test.ts

# gerçek denetim (Chrome gerekir, ~10 sn)
node scripts/run-unit.cjs scripts/lighthouse-live-test.ts
```

Canlı test yerel bir HTTP sunucusu açar, basit bir HTML sayfası sunar ve gerçek
Lighthouse denetimini çalıştırır. Ölçülen süre: ~8 saniye (yerel sayfa, 3 kategori).

## Sınırlar

- Yalnızca tek sayfa denetlenir; site geneli tarama (crawl) yoktur.
- `file://` desteklenmez — Lighthouse yalnızca http(s) kabul eder. Yerel derlemeyi
  denetlemek için önce `npx serve` benzeri bir sunucu başlatın.
- Kimlik doğrulaması gerektiren sayfalar için çerez/oturum aktarımı yoktur.
- Chrome kurulu değilse araç hata döner; Edge ile çalıştırmak için `CHROME_PATH`
  ortam değişkenini ayarlayın.
- Sonuçlar tek çalıştırmaya aittir; laboratuvar koşullarında ağ gecikmesi dalgalanır.
