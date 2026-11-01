# OpenCode eşliği: hata, zaman aşımı ve sürdürme

Bu belge, OpenCode Desktop **2.2.5** davranışının EVREN Desktop'a nasıl
aktarıldığını kaydeder. Kaynaklar:

- `anomalyco/opencode` deposu, `dev` dalı (`69269e4`, 2026-11-01)
- `packages/ai/src/schema/options.ts`, `packages/ai/src/route/transport/http.ts`
- `packages/ai/src/provider-error.ts`
- `packages/core/src/model-retry.ts`
- `packages/core/src/session/runner/{llm,step,retry,max-steps}.ts`
- Kurulu `opencode-cli.exe` (2.2.5) içindeki sınıflandırma tabloları

## 1. Üç katmanlı zaman aşımı

| Katman | Ne ölçer | OpenCode | Biz |
|---|---|---|---|
| `headerTimeout` | Başlıklar gelene kadar | 300 000 ms | `DEFAULT_HEADER_TIMEOUT_MS` |
| `chunkTimeout` | İki parça arası | 900 000 ms | `DEFAULT_CHUNK_TIMEOUT_MS` |
| `totalTimeout` | İstek başından sonuna | **sınırsız** | sınırsız (`0`) |

OpenCode neden 15 dakika? `options.ts:58`:

> "Some providers, such as DeepSeek, have specifically asked clients to allow
> at least 15 minutes, because their models can stream nothing for minutes
> while they reason."

**Bu, 0.3.3'teki 60 saniyelik eşiğin yanlış olduğunu gösterir.** DeepSeek
dakikalarca sessiz kalabilir; 60 sn meşru bir düşünme akışını öldürür.

Uygulama: `src/main/sse.ts` → `createTimer`, `phaseState` (header/read/total).
Ortam ile geçersiz kılma: `EVREN_STREAM_HEADER_TIMEOUT_MS`,
`EVREN_STREAM_CHUNK_TIMEOUT_MS`, `EVREN_STREAM_TOTAL_TIMEOUT_MS`.

## 2. Hata sınıflandırma

`src/main/ai/error.ts` — OpenCode `provider-error.ts:88` tablosu:

| Sınıf | Yeniden denenir | Neden |
|---|---|---|
| `RateLimit` | ✅ | Geçici |
| `ProviderInternal` | ✅ | Aşırı yük / sağlayıcı hatası |
| `Transport` | ✅ koşullu | `rejected` değilse ve (`accepted` değilse veya `read` ise) |
| `InvalidProviderOutput` | ✅ yalnızca `incomplete-stream` | Eksik akış |
| `UnknownProvider` | ✅ | "Geçici arızalar tam olarak sınıflandırıcının öngörmediği biçimlerde gelir" |
| `Authentication` | ❌ | |
| `QuotaExceeded` | ❌ | |
| `ContentPolicy` | ❌ | |
| `InvalidRequest` | ❌ | |
| `UnsupportedOperation` | ❌ | |
| `Timeout` | ❌ | Deneme zaten dakikalarca bekledi |

`x-should-retry` başlığı her şeyi ezer.

Sınıflandırma **önce kotayı** kontrol eder (OpenCode: "hesap kotaları 429/402
olarak gelir ama bunlar throttle değildir").

## 3. Retry zamanlaması

`src/main/retry.ts` — OpenCode `model-retry.ts:25`:

```
Schedule.min([exponential("2 seconds"), spaced("10 seconds")])
Schedule.recurs(10)
Schedule.jittered          // 0.8–1.2
```

Sıra: **2, 4, 8, 10, 10, 10, 10, 10, 10, 10** saniye → toplam **84 s**
(jitter ile 67–101 s).

| Sabit | Değer |
|---|---|
| `BASE_DELAY_MS` | 2 000 |
| `DELAY_CAP_MS` | 10 000 |
| `MAX_RETRIES` | 10 |
| `RETRY_AFTER_MAX_MS` | 900 000 (15 dk) |
| `MAX_TIMEOUT_RETRIES` | 3 |

`Retry-After` verildiyse **planlanan ile sunucunun istediğinin büyüğü** alınır
(`Duration.max`), 15 dakika ile sınırlanır.

## 4. Retry durumu

OpenCode retry'yi kalıcı bir mesaj alanı olarak tutar:

```ts
Session.Message.Assistant.Retry = { attempt, at, error }
Session.StructuredError = { type, message, status, response, retryAfterMs }
```

Bizde `retry` bir `ChatEvent` olarak arayüze gider ve besteci rozetinde
gösterilir. Kalıcı hâle getirmek `StoredMessage` şemasını değiştirir (göç
gerekir); bu belge o işi **açık borç** olarak kaydeder.

## 5. Kesilen yanıtı sürdürme (en önemli fark)

OpenCode iki durumda "yeniden dene" değil **"devam ettir"** yapar
(`step.ts:211`, `:272`):

1. **`Outcome.Continue`** — çıktı başladıktan sonra akış kesildi
2. **`Outcome.OutputLimit`** — `finish === "length"`

```ts
// llm.ts:330
await retry.wait({ decision, assistantMessageID, error })
bus.publish(SessionEvent.Synthetic, {
  text: 'The previous response was interrupted. Continue from where you left off without repeating completed content.',
})
assistantMessageID = SessionMessage.ID.create()
```

Uygulama: `src/main/ai/continuation.ts` → `streamWithContinuation`:

- Kısmi içerik korunur ve geçmişe asistan mesajı olarak yazılır
- Sentetik kullanıcı mesajı eklenir (`CONTINUE_AFTER_INCOMPLETE` /
  `CONTINUE_AFTER_OUTPUT_LIMIT`)
- Yeni tur eklenir; kullanıcı tek parça metin görür
- En fazla 5 devam turu (sonsuz döngü koruması)

Bağlandığı yerler: `agent/loop.ts`, `chat.ts` (düz akış), `multiverse.ts`
(sentez), `agent/subagent.ts`.

Arayüz `continue` olayını bildirim olarak gösterir:
"Yanıt kesildi — kaldığı yerden sürdürülüyor (1)".

## 6. Adım sınırı

OpenCode'da `agent.steps` **isteğe bağlıdır**; tanımlı değilse sınır yok
(`llm.ts:252`). Sınır varsa son turda:

- `MAX_STEPS_PROMPT` gönderilir (araç yasağı, metin zorunluluğu, özet + kalan
  işler + öneri)
- `toolChoice: "none"` yapılır
- **Araç tanımları korunur** (sağlayıcı önbelleği için)

Bizde aynısı: `AgentOptions.steps` (isteğe bağlı), `MAX_STEPS_PROMPT`,
`tool_choice: 'none'`, araç tanımları korunur. Sınır verilmezse varsayılan
yoktur; `EVREN_AGENT_MAX_STEPS` ile tavan konabilir.

Ek güvenlik: sınır turunda sağlayıcı yine araç çağrısı döndürürse **yürütülmez**;
metin gelmediyse araçsız son bir tur atılır (`finalizeRun`).

## 7. Fark tablosu (önce → sonra)

| Yetenek | Önce | Sonra |
|---|---|---|
| Sessizlik toleransı | 60 sn | **15 dk parça / 5 dk başlık** |
| Zaman aşımı katmanı | 1 | **3** |
| Hata sınıflandırma | HTTP kodu | **11 sınıf + başlık** |
| Deneme sayısı | 4 (~15 sn) | **10 (~84 sn)** |
| Zaman aşımı kotası | yok | **3** |
| `Retry-After` sınırı | 2 dk | **15 dk** |
| Kısmi çıktı sonrası | hata | **devam ettir** |
| Token limiti sonrası | durur | **devam ettir** |
| Adım sınırı | 20 (sabit) | **varsayılan yok** |
| Sınır turu | araçsız ek tur | **MAX_STEPS_PROMPT + tool_choice none** |

## 8. Bilinçli kalan farklar

1. **Kalıcı retry durumu** — OpenCode mesaj alanı + olay günlüğü tutar; bizde
   geçici olay. `StoredMessage` göçü gerektirir.
2. **Olay günlüğü / yeniden eşitleme** — OpenCode durable event log ile
   arayüzü her an yeniden kurar. Bizde akış ana süreçte biriktiriliyor
   (`chatStreamTracker`) ama diskte olay günlüğü yok.
3. **`MAX_STEPS_PROMPT` dili** — metin Türkçe; OpenCode İngilizce gönderir.
   Yapı ve kurallar birebir aynı.

## 9. Testler

| Paket | Kontrol | Ne doğrular |
|---|---|---|
| `retry-test` | 66 | Sınıflandırma, retry tablosu, zamanlama, jitter, kota |
| `stream-idle-test` | 11 | Üç zaman aşımı katmanı, yavaş akış, iptal |
| `continuation-test` | 20 | Kesilme → devam, token limiti → devam, sınır |
| `retry-live-test` | 13 | Gerçek 503 dizisi, Retry-After, kalıcı hata |
| `max-steps-test` | 12 | `MAX_STEPS_PROMPT`, sınır turu, özet |
| `parallel-hang-test` | 12 | Paralel koşuda bekleyen istek |

Toplam: `npm run test:unit` → **34 paket / 689 kontrol**.
