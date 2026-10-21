# İnceleme Paneli + Görev Göstergesi

OpenCode referansıyla eklenen iki özellik.

## 1. İnceleme paneli (Review)

### OpenCode gözlemi (REA/statik tarama)
- `session-review-v2` chunk'ı; `command.review.toggle` = "Toggle review".
- `ui.sessionReview.title` = "Session changes" / "Git changes" / "Branch changes" /
  "Last turn changes".
- Diff stilleri: unified / split; expand all / collapse all.
- Değişiklik türleri: added / removed / modified; görsel önizleme.

### EVREN Desktop uyarlaması
EVREN Desktop'ta proje/git çalışma alanı olmadığı için inceleme paneli
**modelin ürettiği dosyalara (artifact)** uyarlanmıştır.

Desteklenen üretim biçimi:
````md
```markdown title="notlar.md"
# Başlık
İçerik
```
````
- `title=`, `filename=`, `file=`, `name=` desteklenir.
- Başlıksız `markdown`/`md` blokları ilk başlıktan dosya adı üretir
  (`# Diğer Not` → `diğer-not.md`).
- Başlıklı tüm kod blokları (`ts`, `json`, `py` vb.) artifact olur.

### Davranış
- Asistan mesajının altında artifact çipleri: `▤ notlar.md · 28 b`.
- Çipe tıklayınca sağda **inceleme paneli** açılır.
- Panelde:
  - Markdown ise render edilir; değilse `<pre><code>`.
  - **Kopyala**, **Kaydet** (native dosya kaydetme diyaloğu), **Kapat**.
  - Boyut ve dil bilgisi (`28 b · markdown`).
- **Ctrl+Shift+R** incelemeyi aç/kapatır (son artifact'ı gösterir).
- Artifact'ler mesaj içeriğinden türetilir; ayrıca saklanmaz.

## 2. Görev göstergesi (Running tasks)

### OpenCode gözlemi
- `session.running.running.one` = "{{count}} running".
- `session.running.working.*`, `session.running.additionalRunning.*`.
- `session.running.stop.subagent`, `session.running.stop.shell`.
- `Session.Message.ToolState.Running`.

### EVREN Desktop uyarlaması
Sohbet alanının üstünde kompakt bir gösterge:
```
◌ 1 çalışıyor  ···
```
- Tıklanınca **çalışan görevler** listesi açılır:
  - `Yanıt üretiliyor` / `Ajan yanıtı üretiliyor`
  - `Araç: browser_open` (çalışan araç çağrıları)
  - `Üye model: gemma-4-31b` (Çoklu Evren üyeleri)
  - `Sentez: deepseek-v4.1-flash`
  - `Oturum sıkıştırılıyor`
- **Durdur** düğmesi aktif isteği iptal eder (`chat:abort`).
- Görev yoksa gösterge gizlenir.

## Sınırlamalar
- İnceleme paneli git diff / dosya sistemi değişikliği göstermez; yalnızca
  modelin ürettiği artifact'leri gösterir.
- Artifact'ler ayrı bir dosya olarak saklanmaz; mesajdan yeniden üretilir.
- Görev göstergesi MCP sunucularını/eklenti süreçlerini kapsamaz; sohbet,
  ajan araçları, Çoklu Evren ve compaction ile sınırlıdır.
- `Kaydet` native diyalog açar; testte otomatik doğrulanmadı.

## Test
- Ayrıştırıcı: `notlar.md` (28 b), `app.ts` (12 b), `diğer-not.md` (22 b).
- UI (izole veri dizini): artifact çipine tıklama → panelde
  `notlar.md · 28 b · markdown`, `Kopyala`, `Kaydet`, `# Başlık / Merhaba dünya.`
