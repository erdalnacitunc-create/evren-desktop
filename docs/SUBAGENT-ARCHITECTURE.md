# Alt ajan mimarisi — opencode / Claude Code karşılaştırması

Bu belge, EVREN'in alt ajan (subagent) yapısını iki referans uygulamayla
karşılaştırır ve 0.4.14'te kapatılan/ertelenen farkları gerekçesiyle kaydeder.

Kaynaklar (Ekim–Kasım 2026):

- opencode · [Agents](https://opencode.ai/docs/agents/) ve [Tools → Subagent](https://opencode.ai/docs/tools/)
- Claude Code · [Create custom subagents](https://docs.claude.com/en/docs/claude-code/sub-agents)
- Anthropic Engineering · [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

## Referans davranışlar

### opencode

- `subagent` aracı **çocuk oturum** (`sessionID`) açar; `description` + tam `prompt` alır.
- Alt ajanlar **her zaman arka planda** çalışır: çağrı hemen döner, ebeveyn çocuk
  boşta kalınca `<subagent>` mesajı alır — ve sonraki her iş turundan sonra tekrar.
- Aynı `sessionID`'ye follow-up gönderilerek **aynı çocuk konuşması sürdürülür**;
  çalışan bir çocuğa gelen mesaj mevcut tura katılır.
- Yalnızca `mode: subagent` ajanlar kullanılabilir; **varsayılan iç içe geçme
  derinliği 1**.
- Ebeveynin `subagent` izni hangi ajanları açabileceğini belirler; çocuk **kendi**
  izinlerini kullanır.
- Ajan kataloğu `description` ile sunulur; model hangi ajanı açacağını buna göre seçer.
- `steps` sınırında araçlar kaldırılır ve modelden metin özeti istenir.

### Claude Code

- Alt ajan **kendi bağlam penceresinde**, kendi sistem istemi, araç kümesi ve
  izinleriyle çalışır; yalnızca özet döner.
- `maxTurns` aşılırsa çıktı **kısmi (partial)** işaretlenir ve **resume** edilebilir.
- Varsayılan olarak arka planda başlar; `background: true` ile açıkça arka planda tutulur.
- `tools` / `disallowedTools` ile araç allow/deny; `Agent(agent_type)` ile hangi alt
  ajanların açılabileceği kısıtlanır. **Derinlik sınırı** vardır.
- Model çözümleme sırası: çağrı parametresi → ajan tanımı → ortam değişkeni → ebeveyn.
- `/tasks` canlı ajanları, modeli ve eforu gösterir; `--debug` günlüğü
  `~/.claude/debug/<session-id>.txt`'e yazılır.
- `isolation: worktree` ile ayrı kopya; `memory` ile oturumlar arası öğrenme.

### Anthropic üretim dersleri

- Ajanlar **durumludur**; hata birikerek büyür → **checkpoint + resume** şart.
- **Tam üretim izleme (full production tracing)** olmadan "neden bulamadı"
  sorusu yanıtlanamaz.
- Efor sorguya göre ölçeklenmeli; aşırı fan-out yaygın hata modudur.
- Büyük çıktılar **dosya sistemine** yazılıp ebeveyne hafif referans dönmeli
  ("game of telephone" etkisini azaltır).
- Senkron bekleme darboğazdır; asenkron + bildirim daha iyi ölçeklenir.

## Karşılaştırma tablosu

| Yetenek | opencode | Claude Code | EVREN 0.4.13 | EVREN 0.4.14 |
|---|---|---|---|---|
| Çağırma | `subagent` aracı, çocuk oturum | `Agent` aracı | `spawn_agent` | aynı + `description` |
| Bağlam | ayrı çocuk oturumu | ayrı bağlam penceresi | ayrı mesaj dizisi | aynı |
| Varsayılan çalışma | arka plan | arka plan | ön plan (background opsiyonel) | arka plan önerilir; bekleme bloklamaz |
| Sonuç teslimi | boşta kalınca `<subagent>` mesajı | sonuç dönüşü | `task_wait` (bloklayıcı) | `task_wait` + **tur içi otomatik bildirim** |
| Zaman aşımı | yok (asenkron) | `maxTurns` | `ok:false` (hata gibi) | **`ok:true` "hâlâ çalışıyor"** |
| Devam ettirme | aynı `sessionID`'ye follow-up | `resume` | yok | **`task_continue`** |
| Kısmi sonuç | — | `maxTurns` → partial | `partial` alanı var | uçtan uca + `task_continue` |
| Araç kısıtı | ajan izinleri | `tools`/`disallowedTools` | `readOnly` (explore/review) | aynı |
| Dosya çakışması | yok | `isolation: worktree` (opt-in) | **dosya sahipliği** | aynı |
| Hangi ajanlar açılabilir | `subagent` izni | `Agent(...)` allowlist | sabit enum | aynı |
| Derinlik sınırı | 1 | var | 1 | aynı |
| Model | ajan tanımı → ebeveyn | çağrı → tanım → env → ebeveyn | **ebeveyn (seçili model)** | aynı |
| Canlı durum | çocuk oturum olayları | `/tasks` | `task_status` (tam JSON) | **kompakt + ilerleme** |
| İzleme günlüğü | — | `--debug` dosyası | `main.log` tek satır | **yapılandırılmış JSONL + `task_logs`** |
| Efor ölçekleme | `steps` | `maxTurns`, effort | fan-out planı 1–4 | aynı |

## 0.4.14'te kapatılan farklar

### 1. Bekleme semantiği (en önemli)

Canlı kusur: explore ajanı 09:41:13'te başladı, `task_wait` 120 sn'de `ok=false`
döndü, ajan 09:44:19'da (186 sn) 4820 kr sonuç üretti — ana ajan sonucu hiç
almadı. opencode bunu hiç yaşamaz çünkü beklemez; Claude Code `maxTurns`'ta
kısmi işaretler.

`task_wait` artık:

- görev sürüyorsa **`ok:true`** + "hâlâ çalışıyor, bu bir hata değil" + ilerleme,
- istem JSON'u **yankılamaz** (800 kr bağlam israfı),
- bitince sonucu, hata/iptal ise net nedeni döndürür.

### 2. Tur içi bildirim

opencode'un `<subagent>` mesajının karşılığı: arka plan görevi biterken ebeveyn
hâlâ çalışıyorsa bir sonraki adımda konuşmaya `system` iletisi eklenir. Model
beklemek zorunda kalmadan sonucu kullanabilir.

### 3. `task_continue`

Biten veya kısmi kalan görev **aynı görev kaydı** üzerinde sürdürülür: önceki
istem ve sonuç bağlam olarak verilir, `attempts` artar, general ajanın dosya
sahipliği yeniden alınır. (`SubagentTaskInfo.ownedFiles` bu yüzden saklanır.)

### 4. Ayrıntılı izleme

`subagent-events.jsonl` (4 MB'da döner, tek yedek) + bellek ring'i:

| Aşama | Ne kaydedilir |
|---|---|
| `spawn` | ajan türü, etiket, `files`, istem uzunluğu, etkin/kullanılan slot |
| `gate` | kapı bekleme süresi, ret nedeni |
| `ownership` | alınan yollar, çakışan sahip |
| `start` | model, readOnly, bütçeler, devam mı |
| `step` | adım no, içerik/araç sayısı, süre |
| `tool` | araç, ok, **süre**, zaman aşımı, sonuç uzunluğu, hata |
| `budget` | adım/araç/son tarih kesintisi |
| `finish` | süre, kısmi nedeni, sonuç uzunluğu |
| `error` | mesaj + yığın izi |
| `state`/`resume` | durum geçişleri, deneme sayısı |

Sırlar `redact()` ile maskelenir. Model `task_logs` ile bunları okuyabilir;
insan `main.log`'da aynı olayın özet satırını görür.

## Bilinçli olarak ertelenenler

| Fark | Neden ertelendi |
|---|---|
| Büyük çıktıyı dosyaya yazma | Faydalı (Anthropic), ama artefakt dizini çalışma alanı dışında kalınca `read_file` kapsamına takılır; workspace içine yazmak git kirliliği üretir. Önce `.evren/` + gitignore tasarımı gerekir. |
| Ajan başına araç allowlist | Bizde üç sabit tür var (explore/review/general) ve `readOnly` yeterli. Kullanıcı tanımlı ajan kataloğu geldiğinde gerekli olacak. |
| Worktree izolasyonu | `docs/WORKTREE-DECISION.md`: iş yükünün tamamı okuma; worktree izlenen dosyaların %2,3'ünü görür, sır/`node_modules` gelmez. Katman B olarak opt-in. |
| Alt ajan bağlam sıkıştırma | 12k sonuç tavanı ve 20/30 bütçe şimdilik yeterli; gerçek uzun koşular görülürse eklenir. |
| Ayrı alt ajan modeli | Ürün kararı: alt ajanlar **seçili model** üzerinden koşar (bkz. `docs/HYBRID-AGENT-ARCHITECTURE.md` §6). |

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `subagent-log-test` | 21 | Yazma, sorgu, özet, maskeleme, kırpma, döndürme |
| `subagent-wait-test` | 21 | Zaman aşımı = hata değil, sonuç, kompakt durum, `task_continue`, bildirim, `task_logs` |
| `agent-subagent-limit-test` | 46 | Kapı, bütçe, `refund` |
| `file-ownership-*` | 78 | Sahiplik, araç zorlaması, döngü |

Toplam 0.4.14: **66 paket / 1553 kontrol**.
