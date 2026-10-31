# Ajan süreci

Ajan döngüsü ana süreçten ayrı bir `utilityProcess` içinde çalışabilir durumda.
Bu sayfa mevcut durumu ve sınırları kaydeder.

## Durum tablosu

| Parça | Durum |
|---|---|
| Taşıyıcı protokolü (çerçeveleme, kimlik doğrulama) | ✅ `src/main/transport/protocol.ts` |
| Çift yönlü RPC | ✅ `src/main/transport/rpc.ts` |
| İşçi girişi (`agentWorker`) | ✅ ping/pong, shutdown, `agent.run`, `agent.cancel` |
| Gözetmen (`AgentProcess`) | ✅ başlat/durdur/ping/istek/ajan koşusu, otomatik yeniden başlatma |
| Uzak `SessionRepository` | ✅ işçi `sessions.json`'a yazmaz |
| Uzak `AgentEventSink` | ✅ olaylar `event` mesajlarıyla ana sürece akar |
| Onay/soru köprülerinin taşınması | ⏳ (işçide onay yok; otomatik mod) |
| Üretimde ajanı işçiye devretme | ⏳ (şu an ana süreçte çalışıyor) |

## Dosyalar

| Dosya | Rol |
|---|---|
| `src/main/agent/worker.ts` | İşçi girişi (`out/main/agentWorker.js`) |
| `src/main/agent/process.ts` | `AgentProcess` gözetmeni |
| `src/main/transport/protocol.ts` | NDJSON çerçeveleme + kimlik doğrulama |
| `src/main/transport/rpc.ts` | Çift yönlü istek/yanıt + olay dağıtımı |
| `src/main/transport/remoteSessionRepository.ts` | Uzak oturum deposu ve ana süreç işleyicisi |
| `electron.vite.config.ts` | İki giriş: `index` ve `agentWorker` |

## Sınırlar ve neden önemli

`utilityProcess` içinde **`app` ve `safeStorage` yoktur** (yalnızca `net` ve
`systemPreferences`). Ölçüldü: `electron.app === undefined`.

Bu yüzden işçiye geçen ajan kodu şu kurallara uyar:

| Konu | Çözüm |
|---|---|
| Ayarlar | `agent.run` yüküyle ana süreçten gelir (`runAgent({ settings })`) |
| API anahtarı | Yük ile gelir; işçi `safeStorage` kullanmaz |
| Oturumlar | Uzak depo (`session.*` RPC) — ana süreç tek yazar |
| Yedekler/kontrol noktaları | `EVREN_USER_DATA` ortam değişkeni ile **aynı** klasör |
| Geçici klasör | `EVREN_TEMP_DIR` veya `os.tmpdir()` |
| Beceri / MCP / eklenti | İşçide **kapalı** (`hostlessCapabilities`) — ana süreçte yaşarlar |
| Prettier kancası | `formatOnEdit` ayarı `createTools`'a geçirilir (araçlar ayar okumaz) |

## Taşıma

```text
ana süreç                                    işçi (utilityProcess)
  AgentProcess.runAgentInWorker()                 RpcEndpoint(handler)
    rpc.request('agent.run', payload)  ────────►  runInWorker()
                                        ◄────────  event (her ChatEvent)
                                        ◄────────  response {ok}
```

- Olaylar **istek kimliğiyle** taşınır; `AgentProcess` istek başına sink tutar,
  böylece eşzamanlı koşularda olaylar karışmaz.
- `agent.run` isteği **süresiz** bekler (`timeoutMs <= 0`); uzun ajan koşuları
  zaman aşımına uğramaz.
- `agent.cancel` → işçide `AbortController.abort()`; döngü `done/aborted` üretir.

## Yaşam döngüsü

- `start()` — `fork`; `spawn` bekle; 15 sn zaman aşımı.
  - İşçi dosyası yoksa anlaşılır hata.
  - Başlamadan ölürse başlatma sözü reddedilir (asılı kalmaz).
- `request()` — süreç yoksa otomatik başlatır.
- `stop()` — `shutdown`, `kill`, çıkışı bekle; RPC kapanır ve **bekleyen tüm
  istekler reddedilir**.
- İşçi `disconnect`/`SIGTERM`/`SIGINT` durumunda kendini kapatır.

## Testler

```bash
npm run build
node scripts/run-unit.cjs scripts/agent-process-test.ts   # 20 — yaşam döngüsü
node scripts/run-unit.cjs scripts/remote-session-test.ts  # 13 — uzak depo
node scripts/run-unit.cjs scripts/worker-agent-test.ts    # 25 — işçide ajan
```

`worker-agent-test` gerçek bir süreçte ajanı çalıştırır ve şunları doğrular:
metin akışı, araç çağrısıyla **gerçek dosya yazımı**, oturum erişiminin uzak
olması, iki eşzamanlı koşunun olaylarının karışmaması, iptal (`done/aborted`) ve
kapanış.

## Sırada (10b-4)

1. Onay/soru köprülerinin işçiye taşınması (şu an işçide onay yok)
2. Üretimde `startChat`'in ajan dalını işçiye devretmesi
3. Anahtarın işçi belleğinde uzun süre kalmaması için istek başına geçirilmesi
4. Süreç çökerse koşunun yeniden başlatılması veya kullanıcıya bildirilmesi
