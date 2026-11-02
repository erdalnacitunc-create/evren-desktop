# OpenCode eÅŸliÄŸi: hata, zaman aÅŸÄ±mÄ± ve sÃ¼rdÃ¼rme

Bu belge, OpenCode Desktop **2.2.5** davranÄ±ÅŸÄ±nÄ±n EVREN Desktop'a nasÄ±l
aktarÄ±ldÄ±ÄŸÄ±nÄ± kaydeder. Kaynaklar:

- `anomalyco/opencode` deposu, `dev` dalÄ± (`69269e4`, 2026-11-01)
- `packages/ai/src/schema/options.ts`, `packages/ai/src/route/transport/http.ts`
- `packages/ai/src/provider-error.ts`
- `packages/core/src/model-retry.ts`
- `packages/core/src/session/runner/{llm,step,retry,max-steps}.ts`
- Kurulu `opencode-cli.exe` (2.2.5) iÃ§indeki sÄ±nÄ±flandÄ±rma tablolarÄ±

## 1. ÃœÃ§ katmanlÄ± zaman aÅŸÄ±mÄ±

| Katman | Ne Ã¶lÃ§er | OpenCode | Biz |
|---|---|---|---|
| `headerTimeout` | BaÅŸlÄ±klar gelene kadar | 300 000 ms | `DEFAULT_HEADER_TIMEOUT_MS` |
| `chunkTimeout` | Ä°ki parÃ§a arasÄ± | 900 000 ms | `DEFAULT_CHUNK_TIMEOUT_MS` |
| `totalTimeout` | Ä°stek baÅŸÄ±ndan sonuna | **sÄ±nÄ±rsÄ±z** | sÄ±nÄ±rsÄ±z (`0`) |

OpenCode neden 15 dakika? `options.ts:58`:

> "Some providers, such as DeepSeek, have specifically asked clients to allow
> at least 15 minutes, because their models can stream nothing for minutes
> while they reason."

**Bu, 0.3.3'teki 60 saniyelik eÅŸiÄŸin yanlÄ±ÅŸ olduÄŸunu gÃ¶sterir.** DeepSeek
dakikalarca sessiz kalabilir; 60 sn meÅŸru bir dÃ¼ÅŸÃ¼nme akÄ±ÅŸÄ±nÄ± Ã¶ldÃ¼rÃ¼r.

Uygulama: `src/main/sse.ts` â†’ `createTimer`, `phaseState` (header/read/total).
Ortam ile geÃ§ersiz kÄ±lma: `EVREN_STREAM_HEADER_TIMEOUT_MS`,
`EVREN_STREAM_CHUNK_TIMEOUT_MS`, `EVREN_STREAM_TOTAL_TIMEOUT_MS`.

## 2. Hata sÄ±nÄ±flandÄ±rma

`src/main/ai/error.ts` â€” OpenCode `provider-error.ts:88` tablosu:

| SÄ±nÄ±f | Yeniden denenir | Neden |
|---|---|---|
| `RateLimit` | âœ… | GeÃ§ici |
| `ProviderInternal` | âœ… | AÅŸÄ±rÄ± yÃ¼k / saÄŸlayÄ±cÄ± hatasÄ± |
| `Transport` | âœ… koÅŸullu | `rejected` deÄŸilse ve (`accepted` deÄŸilse veya `read` ise) |
| `InvalidProviderOutput` | âœ… yalnÄ±zca `incomplete-stream` | Eksik akÄ±ÅŸ |
| `UnknownProvider` | âœ… | "GeÃ§ici arÄ±zalar tam olarak sÄ±nÄ±flandÄ±rÄ±cÄ±nÄ±n Ã¶ngÃ¶rmediÄŸi biÃ§imlerde gelir" |
| `Authentication` | âŒ | |
| `QuotaExceeded` | âŒ | |
| `ContentPolicy` | âŒ | |
| `InvalidRequest` | âŒ | |
| `UnsupportedOperation` | âŒ | |
| `Timeout` | âŒ | Deneme zaten dakikalarca bekledi |

`x-should-retry` baÅŸlÄ±ÄŸÄ± her ÅŸeyi ezer.

SÄ±nÄ±flandÄ±rma **Ã¶nce kotayÄ±** kontrol eder (OpenCode: "hesap kotalarÄ± 429/402
olarak gelir ama bunlar throttle deÄŸildir").

## 3. Retry zamanlamasÄ±

`src/main/retry.ts` â€” OpenCode `model-retry.ts:25`:

```
Schedule.min([exponential("2 seconds"), spaced("10 seconds")])
Schedule.recurs(10)
Schedule.jittered          // 0.8â€“1.2
```

SÄ±ra: **2, 4, 8, 10, 10, 10, 10, 10, 10, 10** saniye â†’ toplam **84 s**
(jitter ile 67â€“101 s).

| Sabit | DeÄŸer |
|---|---|
| `BASE_DELAY_MS` | 2 000 |
| `DELAY_CAP_MS` | 10 000 |
| `MAX_RETRIES` | 10 |
| `RETRY_AFTER_MAX_MS` | 900 000 (15 dk) |
| `MAX_TIMEOUT_RETRIES` | 3 |

`Retry-After` verildiyse **planlanan ile sunucunun istediÄŸinin bÃ¼yÃ¼ÄŸÃ¼** alÄ±nÄ±r
(`Duration.max`), 15 dakika ile sÄ±nÄ±rlanÄ±r.

## 4. Retry durumu

OpenCode retry'yi kalÄ±cÄ± bir mesaj alanÄ± olarak tutar:

```ts
Session.Message.Assistant.Retry = { attempt, at, error }
Session.StructuredError = { type, message, status, response, retryAfterMs }
```

Bizde `retry` bir `ChatEvent` olarak arayÃ¼ze gider ve besteci rozetinde
gÃ¶sterilir. KalÄ±cÄ± hÃ¢le getirmek `StoredMessage` ÅŸemasÄ±nÄ± deÄŸiÅŸtirir (gÃ¶Ã§
gerekir); bu belge o iÅŸi **aÃ§Ä±k borÃ§** olarak kaydeder.

## 5. Kesilen yanÄ±tÄ± sÃ¼rdÃ¼rme (en Ã¶nemli fark)

OpenCode iki durumda "yeniden dene" deÄŸil **"devam ettir"** yapar
(`step.ts:211`, `:272`):

1. **`Outcome.Continue`** â€” Ã§Ä±ktÄ± baÅŸladÄ±ktan sonra akÄ±ÅŸ kesildi
2. **`Outcome.OutputLimit`** â€” `finish === "length"`

```ts
// llm.ts:330
await retry.wait({ decision, assistantMessageID, error })
bus.publish(SessionEvent.Synthetic, {
  text: 'The previous response was interrupted. Continue from where you left off without repeating completed content.',
})
assistantMessageID = SessionMessage.ID.create()
```

Uygulama: `src/main/ai/continuation.ts` â†’ `streamWithContinuation`:

- KÄ±smi iÃ§erik korunur ve geÃ§miÅŸe asistan mesajÄ± olarak yazÄ±lÄ±r
- Sentetik kullanÄ±cÄ± mesajÄ± eklenir (`CONTINUE_AFTER_INCOMPLETE` /
  `CONTINUE_AFTER_OUTPUT_LIMIT`)
- Yeni tur eklenir; kullanÄ±cÄ± tek parÃ§a metin gÃ¶rÃ¼r
- En fazla 5 devam turu (sonsuz dÃ¶ngÃ¼ korumasÄ±)

BaÄŸlandÄ±ÄŸÄ± yerler: `agent/loop.ts`, `chat.ts` (dÃ¼z akÄ±ÅŸ), `multiverse.ts`
(sentez), `agent/subagent.ts`.

ArayÃ¼z `continue` olayÄ±nÄ± bildirim olarak gÃ¶sterir:
"YanÄ±t kesildi â€” kaldÄ±ÄŸÄ± yerden sÃ¼rdÃ¼rÃ¼lÃ¼yor (1)".

## 6. AdÄ±m sÄ±nÄ±rÄ±

OpenCode'da `agent.steps` **isteÄŸe baÄŸlÄ±dÄ±r**; tanÄ±mlÄ± deÄŸilse sÄ±nÄ±r yok
(`llm.ts:252`). SÄ±nÄ±r varsa son turda:

- `MAX_STEPS_PROMPT` gÃ¶nderilir (araÃ§ yasaÄŸÄ±, metin zorunluluÄŸu, Ã¶zet + kalan
  iÅŸler + Ã¶neri)
- `toolChoice: "none"` yapÄ±lÄ±r
- **AraÃ§ tanÄ±mlarÄ± korunur** (saÄŸlayÄ±cÄ± Ã¶nbelleÄŸi iÃ§in)

Bizde aynÄ±sÄ±: `AgentOptions.steps` (isteÄŸe baÄŸlÄ±), `MAX_STEPS_PROMPT`,
`tool_choice: 'none'`, araÃ§ tanÄ±mlarÄ± korunur. SÄ±nÄ±r verilmezse varsayÄ±lan
yoktur; `EVREN_AGENT_MAX_STEPS` ile tavan konabilir.

Ek gÃ¼venlik: sÄ±nÄ±r turunda saÄŸlayÄ±cÄ± yine araÃ§ Ã§aÄŸrÄ±sÄ± dÃ¶ndÃ¼rÃ¼rse **yÃ¼rÃ¼tÃ¼lmez**;
metin gelmediyse araÃ§sÄ±z son bir tur atÄ±lÄ±r (`finalizeRun`).

## 7. Fark tablosu (Ã¶nce â†’ sonra)

| Yetenek | Ã–nce | Sonra |
|---|---|---|
| Sessizlik toleransÄ± | 60 sn | **15 dk parÃ§a / 5 dk baÅŸlÄ±k** |
| Zaman aÅŸÄ±mÄ± katmanÄ± | 1 | **3** |
| Hata sÄ±nÄ±flandÄ±rma | HTTP kodu | **11 sÄ±nÄ±f + baÅŸlÄ±k** |
| Deneme sayÄ±sÄ± | 4 (~15 sn) | **10 (~84 sn)** |
| Zaman aÅŸÄ±mÄ± kotasÄ± | yok | **3** |
| `Retry-After` sÄ±nÄ±rÄ± | 2 dk | **15 dk** |
| KÄ±smi Ã§Ä±ktÄ± sonrasÄ± | hata | **devam ettir** |
| Token limiti sonrasÄ± | durur | **devam ettir** |
| AdÄ±m sÄ±nÄ±rÄ± | 20 (sabit) | **varsayÄ±lan yok** |
| SÄ±nÄ±r turu | araÃ§sÄ±z ek tur | **MAX_STEPS_PROMPT + tool_choice none** |

## 8. BilinÃ§li kalan farklar

1. **KalÄ±cÄ± retry durumu** â€” OpenCode mesaj alanÄ± + olay gÃ¼nlÃ¼ÄŸÃ¼ tutar; bizde
   geÃ§ici olay. `StoredMessage` gÃ¶Ã§Ã¼ gerektirir.
2. **Olay gÃ¼nlÃ¼ÄŸÃ¼ / yeniden eÅŸitleme** â€” OpenCode durable event log ile
   arayÃ¼zÃ¼ her an yeniden kurar. Bizde akÄ±ÅŸ ana sÃ¼reÃ§te biriktiriliyor
   (`chatStreamTracker`) ama diskte olay gÃ¼nlÃ¼ÄŸÃ¼ yok.
3. **`MAX_STEPS_PROMPT` dili** â€” metin TÃ¼rkÃ§e; OpenCode Ä°ngilizce gÃ¶nderir.
   YapÄ± ve kurallar birebir aynÄ±.

## 9. Testler

| Paket | Kontrol | Ne doÄŸrular |
|---|---|---|
| `retry-test` | 66 | SÄ±nÄ±flandÄ±rma, retry tablosu, zamanlama, jitter, kota |
| `stream-idle-test` | 11 | ÃœÃ§ zaman aÅŸÄ±mÄ± katmanÄ±, yavaÅŸ akÄ±ÅŸ, iptal |
| `continuation-test` | 20 | Kesilme â†’ devam, token limiti â†’ devam, sÄ±nÄ±r |
| `retry-live-test` | 13 | GerÃ§ek 503 dizisi, Retry-After, kalÄ±cÄ± hata |
| `max-steps-test` | 12 | `MAX_STEPS_PROMPT`, sÄ±nÄ±r turu, Ã¶zet |
| `parallel-hang-test` | 12 | Paralel koÅŸuda bekleyen istek |

Toplam: `npm run test:unit` â†’ **34 paket / 689 kontrol**.

## 10. KalÄ±cÄ± retry durumu (0.4.1)

OpenCode retry bilgisini mesajÄ±n alanÄ± olarak tutar
(`Session.Message.Assistant.Retry = { attempt, at, error }`). AynÄ±sÄ± aktarÄ±ldÄ±.

**Åema** (`src/shared/types.ts`):

```ts
interface StoredRetry {
  attempt: number
  at: number                    // sonraki denemenin zaman damgasÄ±
  error: { type, message, status?, retryAfterMs? }
}

interface StoredMessage {
  ...
  retry?: StoredRetry
  continuations?: number
}
```

**GÃ¶Ã§** (`src/main/sessionMigration.ts`):

- Disk biÃ§imi v1 (dÃ¼z dizi) â†’ v2 (`{ version, sessions }`)
- Eski dosyalar bozulmadan yÃ¼klenir; eksik alanlar onarÄ±lÄ±r, bozuk kayÄ±tlar
  atlanÄ±r ve raporlanÄ±r
- GÃ¶Ã§ idempotenttir; yÃ¼klemeden sonra yeni biÃ§imde geri yazÄ±lÄ±r
- `sessionStore` her aÃ§Ä±lÄ±ÅŸta gÃ¶Ã§Ã¼ Ã§alÄ±ÅŸtÄ±rÄ±r

**Yazma noktalarÄ±:**

| Olay | YazÄ±lan |
|---|---|
| `retry` (yeniden deneme planlandÄ±) | `retry = { attempt, at, error }` |
| `continue` (yanÄ±t sÃ¼rdÃ¼rÃ¼lÃ¼yor) | `retry` temizlenir, `continuations++` |
| `done` / `error` | `retry` temizlenir |

**ArayÃ¼z:** oturum aÃ§Ä±ldÄ±ÄŸÄ±nda son 10 dakika iÃ§indeki `retry` bilgisi
bildirim olarak gÃ¶sterilir (kalan saniye dahil). Uygulama kapanÄ±p aÃ§Ä±lsa bile
kaybolmaz.

## 11. Olay gÃ¼nlÃ¼ÄŸÃ¼ ve yeniden eÅŸitleme

OpenCode her kalÄ±cÄ± olayÄ± `{ aggregate: "sessionID", version }` ile yazar ve
bir projector bunlarÄ± mesajlara katlar; arayÃ¼z `session.sync` ile her an
yeniden kurabilir.

Bizde (`src/main/sessionEvents.ts`):

- **GÃ¼nlÃ¼k dosyasÄ±:** `<userData>/session-events.jsonl` â€” satÄ±r baÅŸÄ±na bir olay
- **Olay biÃ§imi:** `{ seq, sessionId, type, at, data }`
- **Ekleme atomik:** yarÄ±m yazma yalnÄ±zca son satÄ±rÄ± bozar, o satÄ±r atlanÄ±r
- **Projeksiyon saf fonksiyon:** `projectSession(events) â†’ messages`

Olay tÃ¼rleri (`session.*` eÅŸlemesi):

| Olay | Ne yapar |
|---|---|
| `session.created` | oturum aÃ§Ä±ldÄ± |
| `user.message` | kullanÄ±cÄ± mesajÄ± |
| `assistant.started` | asistan turu baÅŸladÄ± |
| `text.delta` / `reasoning.delta` | metin/dÃ¼ÅŸÃ¼nme parÃ§asÄ± |
| `retry.scheduled` / `retry.cleared` | yeniden deneme durumu |
| `continue.started` | sÃ¼rdÃ¼rme turu |
| `tool.called` / `tool.result` | araÃ§ Ã§aÄŸrÄ±sÄ± ve sonucu |
| `step.ended` | adÄ±m bitti (finishReason, usage) |
| `assistant.completed` / `assistant.failed` | tur bitti |
| `session.renamed` | baÅŸlÄ±k deÄŸiÅŸti |

**Yeniden eÅŸitleme:** `session:sync` IPC kanalÄ± (`api.app.syncSession`) bir
oturumun gÃ¼nlÃ¼ÄŸÃ¼nÃ¼ okuyup projeksiyonunu dÃ¶ndÃ¼rÃ¼r. ArayÃ¼z oturum aÃ§Ä±lÄ±rken
bunu Ã§aÄŸÄ±rÄ±r; gÃ¼nlÃ¼kte arayÃ¼zden fazla mesaj varsa veya bozuk kayÄ±t atlandÄ±ysa
kullanÄ±cÄ±ya bildirir.

**SÄ±ra numarasÄ±:** oturum baÅŸÄ±na artan `seq`; gÃ¼nlÃ¼kten tohumlanÄ±r, bÃ¶ylece
uygulama yeniden baÅŸlasa da Ã§akÄ±ÅŸma olmaz.

## 12. Test kapsamÄ±

| Paket | Kontrol | Kapsam |
|---|---|---|
| `migration-test` | 32 | v1â†’v2, bozuk kayÄ±t, onarÄ±m, idempotent |
| `migration-file-test` | 19 | GerÃ§ek dosya: eski biÃ§im yÃ¼klenir, yeni biÃ§imde yazÄ±lÄ±r |
| `session-events-test` | 40 | Projeksiyon, retry/continue, bozuk satÄ±r, sÄ±ra |
| `event-log-e2e-test` | 21 | startChat â†’ gÃ¼nlÃ¼k â†’ projeksiyon = depo |

Toplam: **38 paket / 801 kontrol**.

## 10. Kalıcı retry durumu (0.4.1)

OpenCode retry bilgisini mesajın alanı olarak tutar
(`Session.Message.Assistant.Retry = { attempt, at, error }`). Aynısı aktarıldı.

**Şema** (`src/shared/types.ts`):

```ts
interface StoredRetry {
  attempt: number
  at: number                    // sonraki denemenin zaman damgası
  error: { type, message, status?, retryAfterMs? }
}

interface StoredMessage {
  ...
  retry?: StoredRetry
  continuations?: number
}
```

**Göç** (`src/main/sessionMigration.ts`):

- Disk biçimi v1 (düz dizi) → v2 (`{ version, sessions }`)
- Eski dosyalar bozulmadan yüklenir; eksik alanlar onarılır, bozuk kayıtlar
  atlanır ve raporlanır
- Göç idempotenttir; yüklemeden sonra yeni biçimde geri yazılır
- `sessionStore` her açılışta göçü çalıştırır

**Yazma noktaları:**

| Olay | Yazılan |
|---|---|
| `retry` (yeniden deneme planlandı) | `retry = { attempt, at, error }` |
| `continue` (yanıt sürdürülüyor) | `retry` temizlenir, `continuations++` |
| `done` / `error` | `retry` temizlenir |

**Arayüz:** oturum açıldığında son 10 dakika içindeki `retry` bilgisi
bildirim olarak gösterilir (kalan saniye dahil). Uygulama kapanıp açılsa bile
kaybolmaz.

## 11. Olay günlüğü ve yeniden eşitleme

OpenCode her kalıcı olayı `{ aggregate: "sessionID", version }` ile yazar ve
bir projector bunları mesajlara katlar; arayüz `session.sync` ile her an
yeniden kurabilir.

Bizde (`src/main/sessionEvents.ts`):

- **Günlük dosyası:** `<userData>/session-events.jsonl` — satır başına bir olay
- **Olay biçimi:** `{ seq, sessionId, type, at, data }`
- **Ekleme atomik:** yarım yazma yalnızca son satırı bozar, o satır atlanır
- **Projeksiyon saf fonksiyon:** `projectSession(events) → messages`

Olay türleri (`session.*` eşlemesi):

| Olay | Ne yapar |
|---|---|
| `session.created` | oturum açıldı |
| `user.message` | kullanıcı mesajı |
| `assistant.started` | asistan turu başladı |
| `text.delta` / `reasoning.delta` | metin/düşünme parçası |
| `retry.scheduled` / `retry.cleared` | yeniden deneme durumu |
| `continue.started` | sürdürme turu |
| `tool.called` / `tool.result` | araç çağrısı ve sonucu |
| `step.ended` | adım bitti (finishReason, usage) |
| `assistant.completed` / `assistant.failed` | tur bitti |
| `session.renamed` | başlık değişti |

**Yeniden eşitleme:** `session:sync` IPC kanalı (`api.app.syncSession`) bir
oturumun günlüğünü okuyup projeksiyonunu döndürür. Arayüz oturum açılırken
bunu çağırır; günlükte arayüzden fazla mesaj varsa veya bozuk kayıt atlandıysa
kullanıcıya bildirir.

**Sıra numarası:** oturum başına artan `seq`; günlükten tohumlanır, böylece
uygulama yeniden başlasa da çakışma olmaz.

## 12. Test kapsamı

| Paket | Kontrol | Kapsam |
|---|---|---|
| `migration-test` | 32 | v1→v2, bozuk kayıt, onarım, idempotent |
| `migration-file-test` | 19 | Gerçek dosya: eski biçim yüklenir, yeni biçimde yazılır |
| `session-events-test` | 40 | Projeksiyon, retry/continue, bozuk satır, sıra |
| `event-log-e2e-test` | 21 | startChat → günlük → projeksiyon = depo |

Toplam: **38 paket / 801 kontrol**.
