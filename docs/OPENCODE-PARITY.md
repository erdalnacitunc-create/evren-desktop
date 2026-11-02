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

## 13. Canlı koşu bulguları ve düzeltmeler (0.4.2)

Aynı sorgu ("usb bağlantılarını tara…") dört modelle paralel çalıştırıldı ve
olay günlüğüyle karşılaştırıldı. Sonuçlar:

| Oturum | Model | Süre | Metin | Düşünme | Araç | Bitiş |
|---|---|---|---|---|---|---|
| `3475cdc2` | deepseek-v4.1-flash | 19.1 dk | 2575 | 19 095 | 30 | `stop` |
| `992dae3b` | deepseek-v4.1-flash | 11.0 dk | 1769 | 6668 | 21 | `stop` |
| `cdbaef62` | mimo-v2.6-pro | 5.7 dk | 2190 | 3371 | 10 | `stop` |
| `1f846854` | gemma-4-31b | 2.9 dk | 916 | 1164 | 1 | `stop` |

4514 olay, **0 bozuk satır**, 4/4 tamamlandı, hiç retry/continuation tetiklenmedi.

`992dae3b` — önceki sürümde **0 karakterle `max-steps`** hatası veren oturum —
bu koşuda 1769 karakter, 21 araç ve temiz `stop` ile bitti. Adım sınırının
kaldırılması bildirilen arızayı çözdü.

Koşu dört gerçek kusuru ortaya çıkardı; dördü de bu sürümde kapatıldı.

### 13.1 `usb_devices` ürün adını vermiyordu → model marka uydurdu

**Belirti.** gemma tek araç çağrısıyla `VID_0B05&PID_6206` için "ASIX
Electronics Corp Gigabit Ethernet adaptörü" dedi. Aygıt gerçekte **C-Media
ses kartı**. mimo aynı yanlışı fark edip "önceki kayıtlarda ASIX yazıyordu"
diye not düştü — yani hata kayıttan kaynağa taşınmış.

**Neden.** Araç yalnızca Windows `FriendlyName` alanını okuyordu; bileşik
aygıtlarda bu alan sürücü sınıfıdır ("USB Bileşik Aygıt"), ürün adı değil.
Model elinde yalnızca VID/PID görünce markayı tahmin etti.

**Düzeltme** (`src/main/agent/hardware.ts`):
- `DEVPKEY_Device_BusReportedDeviceDesc` (aygıtın kendi bildirdiği ürün adı) ve
  `DEVPKEY_Device_Manufacturer` okunuyor.
- `UsbDevice` tipine `productName` ve `manufacturer` eklendi.
- Sürücü INF'inden gelen parantezli genel etiketler ("(Standart USB Ana
  Bilgisayar Denetleyicisi)") ürün adı sayılmıyor.
- `usbDeviceReport()` saf fonksiyonu çıktıyı biçimlendiriyor ve modele
  "marka/model tahmin etme, bilinmiyorsa bilinmiyor yaz" kuralını hatırlatıyor.

**Doğrulama.** Bu makinede 12 aygıtın 9'unda ürün adı okundu:
`0B05:6206 → C-Media(R) Audio`, `2B7E:B597 → USB2.0 HD UVC WebCam`.

### 13.2 İç içe `powershell -Command` `$_`'yi boşaltıyordu

**Belirti.** 5 araç hatasının 4'ü aynı sınıftandı:

```text
Where-Object : The term '.InstanceId' is not recognized...
```

**Neden.** `run_command` komutu zaten PowerShell içinde `-EncodedCommand` ile
çalıştırır. Model komutu tekrar `powershell -Command "… $_ …"` ile sarmalayınca
**dış** katman çift tırnak içindeki `$_`'yi kendi kapsamında açar; üst kapsamda
`$_` tanımsız olduğu için boşalır ve iç komuta `.InstanceId` ulaşır.

`cmd.exe /c` ile çalıştırmak denendi: Windows tırnak kuralları Node'un argüman
kaçışıyla çakıştığı için kırılgan (`exit 7` bile 0 dönüyordu).

**Düzeltme** (`src/main/commandShell.ts`, `src/main/workspace.ts`):
- `unwrapNestedPowerShell()` komutun tamamı tek bir sarmalanmış çağrıysa iç
  betiği çıkarır; dış katman zaten PowerShell olduğu için betik **bir kez**
  ayrıştırılır ve `$_` doğru kapsamda açılır.
- `-File` kullanımı, kısmi sarmalama (`cd X; powershell …`) ve zincirleme
  sarmalama çözülmez — davranışları zaten doğru.
- Kaçış biçimleri normalize edilir: `""`, `''`, `\"`.
- Sistem istemine kural eklendi: komutu sarmalama; uzun betik için `.ps1`
  yazıp `-File` ile çalıştır.

### 13.3 `run_code` gibi var olmayan araç adları

**Belirti.** `Bilinmeyen araç: run_code` — doğrusu `execute` idi ve mesaj bunu
söylemediği için model bir tur kaybetti.

**Düzeltme** (`src/main/agent/toolSuggest.ts`):
- `ToolRegistry.names()` eklendi.
- `suggestTool()` sırayla dener: bilinen takma ad (`run_code → execute`,
  `bash → run_command`, `read → read_file` …), normalize birebir eşleşme
  (`Read_File → read_file`), önek eşleşmesi, ölçekli Levenshtein mesafesi.
- Eşik altında kalırsa **öneri yapılmaz** — yanlış aracı çalıştırmak daha
  kötüdür.
- Hem ana döngü hem alt ajan aynı mesajı kullanır.

### 13.4 Adım sınırı kalkınca ilerlemesiz döngü

**Belirti.** `3475cdc2` 19 dakikanın yaklaşık 8 dakikasını `scan_usb.ps1` →
`scan_usb2.ps1` … `scan_usb6.ps1` yazarak geçirdi (30 araç, 19k düşünme).
Sonunda rapor yazıldı, yani felaket değil; ama işin 2-3 katı sürdü.

**Neden.** Sert adım sınırı kaldırıldı ve modele "ne zaman duracağı" hakkında
hiçbir sinyal kalmadı. Sınırı geri getirmek eski "0 karakter + max-steps"
hatasını döndürür — yanlış çözüm.

**Düzeltme** (`src/main/agent/progressGuard.ts`):
- Bir adım "ilerlemesiz" sayılır: metin boş **ve** en az bir araç çağrıldı.
- Son **4** adım böyleyse modele yönlendirme gönderilir: "bulguları şimdi
  raporla, yeni tarama başlatma".
- En çok **2** yönlendirme: birincisi yumuşak, ikincisi kesin ("araç çağırmayı
  şimdi bırak").
- Araç çağrısı **engellenmez** — yalnızca hatırlatma. Model uymazsa çalışma
  durmaz, sadece iki kez uyarılır.
- Eşik ve üst sınır yapılandırılabilir (`threshold`, `maxNudges`).

## 14. Test kapsamı (0.4.2)

| Paket | Kontrol | Kapsam |
|---|---|---|
| `usb-inventory-test` | 12 | Ürün adı okunuyor, genel etiket filtreleniyor, ASIX yanlışı yok |
| `tool-suggest-test` | 42 | Takma ad, normalize, mesafe, uzağa öneri yok |
| `command-shell-test` | 30 | Sarmalama çözme, `$_` korunuyor, `-File`/kısmi dokunulmaz, Türkçe, çok satır |
| `progress-guard-test` | 30 | Eşik, pencere, üst sınır, seri hesabı |
| `progress-nudge-e2e-test` | 7 | Gerçek akış: 4 metinsiz adım → yönlendirme 5. istekte |

Toplam: **43 paket / 922 kontrol**.

## 15. Hafıza kirliliği: geçici gözlemler kalıcı anı olmuş (0.4.2)

### Belirti

Canlı koşuda gemma `0B05:6206` için "ASIX Gigabit Ethernet" dedi. Aygıt
gerçekte C-Media ses kartıydı. mimo aynı yanlışı fark etti ama yine de
"önceki kayıtlarda ASIX yazıyordu" diye dolaşıma soktu.

### Kök neden

Kullanıcının hafıza dosyası incelendi (`%APPDATA%\EVREN Desktop Beta\memory`).
13 anı vardı; **1 Kasım'da kaydedilmiş** kayıt:

```
[reference] Bağlı USB aygıtları arasında ASIX Electronics Corp Gigabit
Ethernet adaptörü (VID_0B05&PID_6206) ve VID_2B7E&PID_B597 kimlikli bir
aygıt bulunmaktadır.
```

Bu bilgi o gün de yanlıştı. İki hafta sonra model onu **güncel gerçek** sandı.

Aynı dosyada başka bayat kayıtlar da vardı:

| Anı | Bugünkü gerçek |
|---|---|
| "Bu ortamda kabuk/terminal aracı yok" | `run_command` var |
| "USB portuna bağlı TP-Link 4G modem bulunuyor" | bağlı değil |
| "Kullanıcının bağlı Android telefonu var" | o an bağlı değil |
| "COM5, COM7, COM9 …" | değişebilir |

### Kural

**Hafıza, araçların ucuzca yeniden türetebileceği şeyleri tutmamalı.**
Takılı USB aygıtları, COM portları, IP adresleri, kurulu araç sürümleri —
hepsi tek araç çağrısıyla güncel hâliyle öğrenilebilir. Hafızada tuttuklarında
eskimek zorunda kalırlar.

### Düzeltme

**`src/main/memory/memoryGuard.ts`** — `volatileReason(text)`:

| Sınıf | Örnek |
|---|---|
| `usb-inventory` | VID/PID, `USB\VID_…`, "COM5 portu" |
| `serial-port` | iki veya daha çok COM portu, `ttyUSB0` |
| `network-address` | IP, MAC, RSSI, "SSID … bağlı" |
| `device-connection` | "şu anda bağlı", "portuna bağlı", "bağlı … bulunuyor" |
| `tool-version` | "esptool 5.3.1", "Python 3.13.12" |
| `tool-availability` | "kabuk/terminal aracı yok" |
| `filesystem-path` | `C:\Users\…` |

**Üç noktada uygulanır:**

1. **Çıkarma** (`extract.ts`): bu sınıfa giren adaylar **kaydedilmez**;
   nedeni loglanır. İstem ayrıca modeli açıkça uyarır ("bunları anı olarak
   üretme").
2. **Göç** (`store.ts` → `demoteVolatileEntries`): eski kayıtlar **silinmez**
   (kullanıcı verisi) ama `volatile: true` + `volatileKind` ile işaretlenir.
   İdempotenttir; `volatile` alanı zaten tanımlıysa dokunulmaz.
3. **Geri getirme** (`retrieve.ts`): geçici anılar %25 puan cezası alır
   (pin'li olanlar muaf) ve modele şu uyarıyla verilir:

   ```
   - [reference] (GEÇMİŞ GÖZLEM — güncel olmayabilir; kullanmadan önce
     ilgili araçla doğrula.) Bağlı USB aygıtları arasında ASIX …
   ```

   Bağlama ek bir paragraf eklenir: "GEÇMİŞ GÖZLEM işaretli anılar eski bir
   ana ait envanter bilgisidir; güncel değeri ilgili araçla doğrula ve
   çelişki varsa araç sonucunu esas al."

### Neden silmiyoruz

Yanlış kayıt silinebilirdi ama:
- Kullanıcı verisidir; sessiz silme geri alınamaz.
- Sınıflandırma sezgiseldir; "yanlış pozitif" bir kalıcı anıyı silebilir.

İşaretleme + uyarı, veriyi korurken zararı durdurur: model artık ya doğrular
ya da "doğrulanamadı" der.

### Doğrulama

Gerçek kullanıcı dosyasındaki 13 anının metni test verisi olarak kullanıldı
(`memory-guard-test` §11): 5'i geçici olarak işaretlenir, "salt-okunur
yaklaşım" gibi kalıcı kayıtlar korunur, ikinci geçiş hiçbir şeyi değiştirmez.

## 16. Olay günlüğü döndürmesi (0.4.2)

`session-events.jsonl` hiç küçülmüyordu; canlı koşu 4514 olay / 1.1 MB üretti.

**`src/main/sessionEventsRotation.ts`:**

- Eşik: **8 MB**. Aşıldığında dosya `session-events.<ISO>.jsonl` olarak
  arşivlenir, boş günlükle devam edilir.
- En yeni **3** arşiv tutulur, eskiler silinir.
- Kontrol her **500** olayda bir yapılır (her olayda `stat` maliyeti olmasın).
- Döndürme **asla akışı durdurmaz**: hata loglanır, yazma sürer.
- `shouldRotate` / `archiveName` / `archivesToDelete` saf fonksiyonlardır.
- ISO zaman damgası sıralanabilir olduğu için "en yeni N" mantığı dosya adı
  sıralamasıyla çalışır; Windows için `:` ve `.` tireye çevrilir.

## 17. Test kapsamı (0.4.2)

| Paket | Kontrol | Kapsam |
|---|---|---|
| `usb-inventory-test` | 12 | Ürün adı, genel etiket filtresi, ASIX yanlışı yok |
| `tool-suggest-test` | 42 | Takma ad, normalize, mesafe, uzağa öneri yok |
| `command-shell-test` | 30 | Sarmalama çözme, `$_` korunuyor, `-File` dokunulmaz |
| `progress-guard-test` | 30 | Eşik, pencere, üst sınır |
| `progress-nudge-e2e-test` | 7 | Yönlendirme 5. istekte gidiyor |
| `memory-guard-test` | 43 | Sınıflandırma, göç, idempotent, gerçek 13 anı |
| `memory-pollution-test` | 15 | Kaydetme işareti, uyarılı geri getirme |
| `session-rotation-test` | 32 | Karar, arşiv adı, keep, gerçek dosya |

Toplam: **46 paket / 1012 kontrol**.

## 18. Kalıcı retry hiç çalışmıyordu (0.4.3)

### Belirti

0.4.2 canlı koşusunda (6 paralel model) mimo oturumu **3 retry** aldı
(`Model şu anda dolu` / HTTP 429). Olay günlüğünde retry'ler görünüyordu,
ama `sessions.json` içinde **hiç** `retry` alanı yoktu:

```
depo sürümü: 2 | oturum: 6
retry alanı olan oturum: 0
```

Yani 0.4.1'de eklenen "kalıcı yeniden deneme durumu" özelliği **hiç
çalışmıyordu**; testler yakalamamıştı çünkü yalnızca saf mantık sınanıyordu.

### Kök neden

`patchAssistantRetry` mesajı `requestId` ile arıyordu:

```ts
if (!session.messages.some((m) => m.requestId === requestId)) return
```

Ama asistan mesajı **akış bitince** yazılıyor (`persist()`), retry bilgisi ise
akış **sürerken** gerekiyor. Retry anında mesaj yok → koşul sağlanmıyor →
yazma sessizce boşa gidiyor. İki ayrı kopya vardı (`chat.ts` ve
`agent/loop.ts`) ve **ikisinde de** aynı boşluk vardı; ajan yolu kullanıldığı
için hiçbiri yazmıyordu.

### Düzeltme

**`src/main/retryState.ts`** — tek ortak uygulama:

- `retry` verilmiş ve mesaj yoksa **yer tutucu** asistan mesajı açılır
  (`content: ''`, `retry` dolu). OpenCode da asistan mesajını akış başında
  oluşturur.
- Mesaj varsa `retry` yazılır ya da temizlenir.
- `retry: null` ve mesaj yoksa boş mesaj yaratılmaz.
- Hata durumunda fırlatmaz; akış sürer.

**Başarıda temizlik.** Retry yer tutucusu, akış başarıyla bitince
temizlenmeli. İlk denemede ayrı bir "temizle" yazımı `persist()` ile
**yarıştı** ve eski değeri geri getirdi. Bu yüzden temizlik `persist()`
içine taşındı: mesaj güncellenirken `retry` alanı açıkça silinir — tek
yazma, yarış yok.

**Boş yer tutucu temizliği.** Akış hiç metin üretmeden hata verirse
`dropEmptyPlaceholder` mesajı kaldırır; arayüzde boş asistan balonu kalmaz.

### Doğrulama (`persist-retry-test`, 11 kontrol)

Sahte sağlayıcı ilk istekte 429 döner:

| Kontrol | Sonuç |
|---|---|
| bekleme penceresinde `retry` kayda yazıldı | ✅ |
| deneme numarası 1, hata türü `Retryable` | ✅ |
| zaman damgası ileriye bakıyor (geri sayım için) | ✅ |
| sunucuya 2 istek, arada ~2 sn bekleme | ✅ |
| başarıdan sonra `retry` temizlendi | ✅ |
| tek asistan mesajı (yer tutucu yeniden kullanıldı) | ✅ |

## 19. Canlı doğrulama: altı model, aynı sorgu (0.4.2)

0.4.2 yayınlandıktan sonra aynı USB sorgusu altı modelle paralel çalıştırıldı.
**11694 olay, 0 bozuk satır, 6/6 tamamlandı.**

| Oturum | Model | Süre | Metin | Araç | ASIX |
|---|---|---|---|---|---|
| `267b848f` | gemma-4-31b | 0.8 dk | 1299 | 1 | yok |
| `91adf438` | deepseek-v4.1-flash | 3.7 dk | 2518 | 7 | düzeltme |
| `5cc7a63d` | glm-5.3 | 4.6 dk | 1509 | 2 | düzeltme |
| `b5fe700e` | deepseek-v4.1-flash | 5.9 dk | 3350 | 8 | düzeltme |
| `3ff4e4de` | qwen3.8-flash-next | 9.3 dk | 4695 | 9 | yok |
| `d1ed8fee` | mimo-v2.6-pro | 11.2 dk | 2247 | 5 | düzeltme (3 retry) |

### Düzeltmelerin canlı kanıtı

**Ürün adı (5.1).** gemma aynı model, aynı sorgu, aynı 1 araç:

| 0.4.1 | 0.4.2 |
|---|---|
| ❌ "ASIX Gigabit Ethernet" | ✅ "C-Media Audio — Ses adaptörü" |
| "VID_2B7E&B597 kimlikli bir aygıt" | ✅ "USB 2.0 HD UVC WebCam" |

**Hafıza kirliliği (5.5).** Açılışta log: `6 geçici anı işaretlendi
(geçmiş gözlem, doğrulanmalı)`. ASIX'in geçtiği her yanıt bir **düzeltme**:

- deepseek: *"Ürün adı 'ASIX Ethernet' değil; C-Media ses arayüzü.
  Marka/model doğrulanamadı"*
- mimo: *"Eski gözlemlerle çelişki var: `VID_0B05&PID_6206` artık ASIX
  Ethernet değil, C-Media USB ses cihazı. Araç sonucu esas alındı."*
- glm: *"Geçmişte 'ASIX' olarak not edilen kimlik, aygıtın kendi bildirdiği
  adla C-Media ses aygıtı olarak raporlandı (marka tahmini yapmadım)"*

**Komut sarmalama (5.2).** Yeni koşuda 32 araç çağrısının yalnızca 1'i
`powershell` içeriyor ve o da doğru desen: `-File .\usb_scan\inspect.ps1`
(uzun betik dosyaya yazılmış). Tek `run_command` hatası geçersiz `-Class`
üyesinden (çıktı yine üretilmiş); `$_` bozulması **sıfır**.

**Araç önerisi (5.3).** `run_code` çağrısı **sıfır** (önceki koşuda 1 hata).

**İlerlemesiz döngü (5.4).** Yönlendirme 3 kez tetiklendi
(`4 adım metinsiz — yönlendirme #1`), her seferinde model rapora geçti;
ikinci (kesin) yönlendirme hiç gerekmedi.

**Verimlilik.** Önceki koşuda deepseek 30 araç / 19.1 dk ve 21 araç / 11.0 dk
harcamıştı. Yeni koşuda aynı model: **8 araç / 5.9 dk** ve **7 araç / 3.7 dk**.

## 20. Test kapsamı (0.4.3)

| Paket | Kontrol | Kapsam |
|---|---|---|
| `persist-retry-test` | 11 | 429 → yer tutucu, kalıcı retry, başarıda temizlik |

Toplam: **47 paket / 1023 kontrol**.
