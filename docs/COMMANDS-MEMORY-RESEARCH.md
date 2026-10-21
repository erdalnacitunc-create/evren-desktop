# Komutlar + Compaction + Hafıza — Araştırma ve Tasarım

Tarih: 2026-10-19
Durum: **Araştırma tamam, tasarım tartışması** — kod yazılmadı.

## 1. Kaynaklar
- OpenCode V2: Commands, Compaction, Snapshots dokümanları + desktop `app.asar` (REA/statik tarama)
- Claude Code: Commands, Memory, Context Window dokümanları + Claude Desktop `app.asar` (REA/statik tarama)
- Mem0 (Apache-2.0), Letta/MemGPT (Apache-2.0), Graphiti/Zep (Apache-2.0)

## 2. OpenCode modeli

### 2.1 Komutlar
- Markdown komutlar: `.opencode/commands/<ad>.md` veya global `~/.config/opencode/commands/`.
- Frontmatter: `description`, `agent`, `model`, `subagent`.
- Gövde prompt şablonu: `$ARGUMENTS`, `$1`, `$2`; eksik argüman fallback.
- JSON komutlar: `commands` altında `template`.
- Shell blokları: `` !`komut` `` (dikkat: izin akışı dışında çalışır).
- Komut yalnızca mesaj başında tanınır; argümanlar komut adından sonra gelir.
- Desktop UI'da komut kayıt modeli:
  - `slash: { name, arguments, after }`
  - `keybind`, `category`, `section`, `hidden`, `enabled`, `run`
  - `slash` + `slashAfter` ile sıralama/alias; komut paleti filtresi.

### 2.2 Compaction
- Yaklaşan context limitinde, son ~15.000 token dışındaki konuşma özetlenir.
- `compaction: { auto: true, keep: { tokens: 15000 }, buffer: 16000 }`
- Manuel: `POST /api/session/{id}/compact`.
- Özet yapısı: Objective, Next Move, kararlar, tamamlanan/aktif işler,
  engeller, ilgili dosyalar.
- Sonraki compaction aynı özeti günceller (sıfırdan başlamaz).
- Provider "native" compaction (OpenAI Responses) opsiyonu.
- UI durumları: started, queued, running, failed, cancelled, interrupted.
- Sınırlar: model = oturum modeli; çok kısa geçmişte çalışmaz; ikinci "too long"
  hatası kullanıcıya döner.

### 2.3 REA kanıtı (OpenCode renderer)
- `slash:{name:` / `slashAfter` / `keybind` / `category` / `section` / `hidden`
- `/compact` → `POST /api/session/${sessionID}/compact`
- `command.session.compact` = "Compact session"
- `command.session.compact.description` = "Summarize the session to reduce context size"
- `ui.messagePart.compaction.*` (started/queued/running/failed/cancelled/interrupted)
- Placeholder: "Ask anything, {{slash}} for commands, {{at}} for context…"

## 3. Claude modeli

### 3.1 Komutlar
- `/` menüsü; komut yalnızca mesaj başında; argümanlar sonrasında.
- Built-in: `/compact [instructions]`, `/clear`, `/context`, `/memory`, `/model`,
  `/config`, `/export`, `/help`, `/rewind`, `/autocompact`.
- **Skills = commands**: `.claude/skills/<ad>/SKILL.md` ve `.claude/commands/<ad>.md`
  aynı `/ad` komutunu üretir.
- Frontmatter: `name`, `description`, `argument-hint`, `disable-model-invocation`,
  `allowed-tools`, `model`, `context: fork`, `paths`, `shell` vb.
- `!` ile dinamik context injection.
- Komut menüsü yazarken filtreler; bazı komutlar gizli.

### 3.2 Auto memory
- `CLAUDE.md` (kullanıcı talimatları) + **auto memory** (modelin kendi notları).
- Konum: `~/.claude/projects/<project>/memory/`
  - `MEMORY.md` index (her oturumda ilk 200 satır / 25KB yüklenir)
  - Konu dosyaları (`user_role.md`, `feedback_testing.md`, ...)
- 4 tür: `user`, `feedback`, `project`, `reference`.
- Kod tabanından çıkarılabilecek şeyler ve CLAUDE.md'de olanlar kaydedilmez.
- `/memory` ile görüntüle/düzenle; `memoryEnabled` ile aç/kapat.
- Oturumlar silinse bile memory kalır.

### 3.3 Context window / compaction
- Başlangıçta yüklenenler: system prompt, auto memory (MEMORY.md), environment,
  MCP tool adları, skill açıklamaları, `~/.claude/CLAUDE.md`, proje `CLAUDE.md`.
- `/compact`: konuşmayı yapılandırılmış özete çevirir.
- Özet korur: istekler/niyet, teknik kavramlar, incelenen/değiştirilen dosyalar,
  hatalar ve çözümleri, bekleyen işler, mevcut iş.
- Kaybolur: tam tool çıktıları, ara reasoning.
- Compact sonrası: başlangıç içeriği yeniden yüklenir, en son değiştirilen ~5 dosya
  yeniden okunur, çağrılan skill'ler yeniden enjekte edilir (skill açıklamaları
  yeniden yüklenmez).
- `/autocompact [auto|<tokens>]`: otomatik compaction penceresi.
- `contextWindowByModel`, `autoCompactWindow` ayarları.
- "Autocompact is thrashing" hata kategorisi: tekrar tekrar compaction yarar
  sağlamıyorsa uyarı.

### 3.4 REA kanıtı (Claude Desktop)
- `autoCompactWindow`, `contextWindowByModel`, `getAutoCompactWindow`,
  `getContextWindowForModel`
- "Autocompact is thrashing" / `autocompact_thrashing`
- Memory ayarları: `memoryEnabled`, `memoryGuidelinesTemplate`,
  `memoryFilesTotal`, `memoryFilesCopied`, `memoryRetryWindowV1`,
  `memoryNotesV1`, `memoryPathRulesV1`, `memoryStatusProjectV1`,
  `memoryKeylessDeviceV1`, `memory_file`, `spaceMemoryCopy`
- "Projects and memory stay" (sohbetler silinse de memory kalır)

## 4. Açık kaynak hafıza repoları

### Mem0 (Apache-2.0, 67k★)
- ADD-only tek geçişli çıkarım (UPDATE/DELETE yok; anılar birikir).
- Entity linking (varlıkları çıkar, embed et, bağla).
- Multi-signal retrieval: semantic + BM25 + entity, füzyon.
- Temporal reasoning: tarihli doğru örneği seç.
- LoCoMo 92.5, LongMemEval 94.4 (yaklaşık 7K token bağlam).
- Çıkarım: `/v1/chat/completions`; embedding: `/v1/embeddings`.

### Letta / MemGPT (Apache-2.0, 25k★)
- Stateful agent'lar; memory block'ları (core memory) + arşiv.
- Ajan kendi hafızasını düzenler; self-improving.

### Graphiti / Zep (Apache-2.0, 32k★)
- Zamansal bilgi grafiği; fact'lerin geçerlilik aralığı.
- Episode provenance, incremental graph construction.
- Hybrid retrieval: semantic + BM25 + graph traversal.
- Çelişen bilgi otomatik geçersiz kılınır (silinmez).

## 5. EVREN Desktop için öneri

### 5.1 Komut sistemi
- Sohbet kutusunda `/` ile **komut paleti** (filtre, ↑/↓, Enter, Esc).
- Yalnızca mesaj başında komut; argümanlar sonrasında.
- Built-in komutlar:
  - `/compact [odak]` — oturumu şimdi sıkıştır
  - `/context` — token/context dağılımı
  - `/clear`, `/new` — yeni oturum (hafıza korunur)
  - `/memory` — hafıza yöneticisini aç
  - `/remember <metin>` — anı kaydet
  - `/forget <sorgu>` — eşleşen anıları sil
  - `/model`, `/agent`, `/params`, `/settings`
  - `/export` — oturumu Markdown/JSON dışa aktar
  - `/help`
  - `/skills`, `/skill <id>` — kurulu becerileri listele/yükle
- Özel komutlar: `%APPDATA%/evren-desktop/commands/*.md`
  - Frontmatter: `description`, `model`, `agent`.
  - `$ARGUMENTS`, `$1`, `$2`.
  - v1'de shell blokları **yok** (güvenlik).
- Kurulu beceriler `/skill-id` olarak paletde görünür (Claude Code deseni).

### 5.2 Compaction
- Ayarlar > Hafıza > Sıkıştırma:
  - `auto` (varsayılan açık)
  - `threshold` (varsayılan: context'in %80'i)
  - `keepTokens` (varsayılan 15.000)
  - `buffer` (%10)
  - `summaryModel`: oturum modeli (varsayılan) veya seçili model
- Tetikleme:
  - Son yanıtın `usage.prompt_tokens` değeri + yeni mesaj tahmini.
  - `context_length` modelden; yoksa 128K varsayılan.
- Özet promptu (yapılandırılmış):
  - Objective, Decisions, Completed, Active, Blockers/Next, Files, User preferences.
- Depolama: `Session.summary` + `summaryUpdatedAt` + `compactedAt`.
- Mesaj derleme: system + memory + summary + son `keepTokens` mesaj.
- `/compact [odak]` manuel; odak metni özete eklenir.
- Compact sonrası: hafıza/talimatlar yeniden enjekte; beceriler korunur.
- "Thrashing" koruması: 5 tur içinde 3 compaction ve anlamlı azalma yoksa
  otomatik compaction'ı duraklat + uyar.
- UI: "Sıkıştırılıyor..." durumu, "Oturum sıkıştırıldı" kartı, özet katlanır.

### 5.3 Hafıza (iki katman)
1. **Kalıcı talimatlar (kullanıcı yazar)**
   - `%APPDATA%/evren-desktop/memory/instructions.md`
   - Her oturumda enjekte edilir; Ayarlar > Hafıza > Talimatlar'dan düzenlenir.
2. **Otomatik hafıza (model yazar)**
   - Türler: `user`, `feedback`, `project`, `reference`.
   - Depo: `memory/memories.json` (+ embedding vektörleri).
   - Alanlar: id, type, text, tags, sourceSessionId, createdAt, updatedAt,
     lastUsedAt, pinned, embedding.
   - Çıkarım: her N turda (varsayılan 4) veya "hatırla" dendiğinde.
   - Model: ucuz model (varsayılan `deepseek-v4-flash`) — seçilebilir.
   - Dedupe: embedding kosinüs > 0.9 veya normalize metin eşleşmesi → güncelle.
   - Sır filtresi: API anahtarı/parola benzeri metinler kaydedilmez.
   - Üst sınır: 2.000 anı; pinlenmemiş en eski kullanılmayanlar çıkarılır.
   - Getirim: prompt embedding'i (`qwen3-embedding-8b`) + kosinüs + recency +
     pin + tür ağırlığı; isteğe bağlı `qwen3-reranker-8b`.
   - Enjeksiyon: en iyi 5-8 anı, ~600-1.000 token sınırı.
   - Embedding yoksa: anahtar kelime + recency fallback.
- Ayarlar > Hafıza:
  - Otomatik hafıza aç/kapat
  - Çıkarım modeli
  - Getirim sayısı / token bütçesi
  - Anı listesi: arama, tür filtresi, düzenle, sil, pinle
  - Manuel anı ekle
  - "Bu oturumdan öğren"
  - Tümünü temizle
  - Depolama yolu + gizlilik notu
- Komutlar: `/memory`, `/remember`, `/forget`.
- Gizlilik: yerel; embedding çağrıları EVREN'e gider; isteğe bağlı DPAPI şifreleme.

### 5.4 Hafıza + compaction etkileşimi
- Compaction öncesi hafıza çıkarımı çalışır; kalıcı bilgiler özete eklenir.
- `/clear` hafızayı silmez (Claude deseni).
- Oturum silinse bile hafıza kalır; kaynak oturum kimliği meta olarak tutulur.

## 6. Yol haritası (öneri)
- **C1:** Komut paleti + built-in komutlar + özel markdown komutlar.
- **C2:** `/compact` + otomatik compaction + özet depolama + context meter.
- **C3:** Manuel hafıza + kalıcı talimatlar + Ayarlar > Hafıza UI.
- **C4:** Otomatik hafıza çıkarımı + embedding/getirim + dedupe.
- **C5:** Becerileri `/skill-id` komutu yapma + cilalama.

## 8. Uygulama durumu (2026-10-19)
- **C1 tamamlandı:** `/` komut paleti; 10 yerleşik komut
  (`/compact`, `/clear`, `/new`, `/memory`, `/remember`, `/forget`, `/skills`,
  `/skill`, `/settings`, `/help`) + özel markdown komutlar + kurulu beceriler
  (`/rea-analysis-optimization` vb.). Toplam **15** komut (5 REA becerisi dahil).
- **C2 tamamlandı:** `/compact` + otomatik compaction (%80 eşik, 15K keep),
  yapılandırılmış özet, oturumda saklama, context meter.
- **C3 tamamlandı:** DPAPI şifreli hafıza deposu, kalıcı talimatlar, anı listesi
  (ara/filtrele/düzenle/sil/pinle), manuel anı ekleme, Ayarlar > Hafıza.
- **C4 tamamlandı:** otomatik anı çıkarımı (oturum modeli), embedding + keyword
  hibrit getirim (`qwen3-embedding-8b`), dedupe, sır filtresi, enjeksiyon.
- **Kanıt:**
  - `commands=15` (10 builtin + 5 skill)
  - `memory_listed=1 retrieved=true context_len=135`
  - `memory_learn_added=1`
  - `compaction=true summary_len=715 count=4 removed=492`
  - UI: Genel / Uzantılar / **Hafıza** sekmeleri, otomatik hafıza ayarları,
    talimatlar, sıkıştırma ayarları, anı listesi.
- **Henüz yok:** özel komutlarda shell blokları (güvenlik nedeniyle),
  `/model`, `/agent`, `/params`, `/export`, `/context` komutları (context meter var).
- **Özel komut dizini:** `%APPDATA%/evren-desktop/commands/*.md`.

## 7. Kararlar (2026-10-19)
- **Otomatik hafıza:** varsayılan **açık**.
- **Getirim:** **embedding + keyword hibrit**.
- **Çıkarım modeli:** **oturum modeli**.
- **Compaction:** **%80 eşik + 15K keep**.
- **Hafıza depolama:** **DPAPI şifreli**.
- **Özel komutlarda shell blokları:** yok (güvenlik).
- **Beceriler `/skill-id` olarak paletde:** evet.
- **Kapsam:** global (tüm sohbetler).
