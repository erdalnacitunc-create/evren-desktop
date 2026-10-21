# Canlı Artifact Önizleme

İnceleme paneli, üretilen artifact türüne göre **Önizleme / Kaynak** görünümü sunar.

## Desteklenen türler

| Tür | Önizleme |
|---|---|
| Markdown | ReactMarkdown + GFM |
| HTML | `iframe` içinde, **sandbox** (script/form/pencere yok) |
| Mermaid | Mermaid SVG render (`securityLevel: strict`) |
| CSV / TSV | Otomatik ayırıcı algılama + tablo (max 200 satır / 30 sütun) |
| SVG | `<img>` data URL (script çalışmaz) |
| PDF | Gömülü önizleme yok; **Kaydet ve aç** ile sistem görüntüleyicisi |

## Güvenlik

- HTML önizleme `sandbox=""` ile çalışır; script’ler, formlar ve popup’lar kapalıdır.
- Mermaid `securityLevel: 'strict'`.
- SVG bir `<img>` etiketiyle gösterilir; iç script’ler çalışmaz.
- Artifact içeriği hiçbir zaman otomatik olarak diske yazılmaz; **Kaydet** gerekir.
- PDF için kaydetme dialogu açılır ve yalnızca seçilen dosya sistem görüntüleyicisinde açılır.

## Notlar

- Mermaid kütüphanesi lazy-load edilir (ayrı chunk).
- Tema değişince Mermaid diyagramı yeniden render edilir.
- Çok büyük CSV’lerde önizleme kısaltılır.
- PDF metin artifact olarak üretilirse görsel önizleme yerine kaydet/aç akışı kullanılır.
