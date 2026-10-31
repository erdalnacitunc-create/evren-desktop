# Ajan süreci

Ajan döngüsü ana süreçten ayrı bir `utilityProcess` içinde çalışacak şekilde
hazırlanıyor. Bu sayfa mevcut durumu ve sınırları kaydeder.

## Mevcut durum (adım 10b-1)

| Parça | Durum |
|---|---|
| Taşıyıcı protokolü (çerçeveleme, kimlik doğrulama) | ✅ `src/main/transport/protocol.ts` |
| İşçi girişi (`agentWorker`) | ✅ ping/pong, shutdown, bilinmeyen yöntem reddi |
| Gözetmen (`AgentProcess`) | ✅ başlat/durdur/ping/istek, otomatik yeniden başlatma |
| Uzak `SessionRepository` | ⏳ |
| Uzak `AgentEventSink` | ⏳ |
| Onay/soru köprülerinin taşınması | ⏳ |
| Üretimde ajanı işçiye devretme | ⏳ (şu an ana süreçte çalışıyor) |

## Dosyalar

| Dosya | Rol |
|---|---|
| `src/main/agent/worker.ts` | İşçi girişi (`out/main/agentWorker.js` olarak derlenir) |
| `src/main/agent/process.ts` | `AgentProcess` gözetmeni |
| `src/main/transport/protocol.ts` | NDJSON çerçeveleme + kimlik doğrulama |
| `electron.vite.config.ts` | İki giriş: `index` ve `agentWorker` |

## Taşıma

`utilityProcess.postMessage()` ile **string** taşınır; içerik NDJSON satırıdır.
Böylece protokol katmanı hem soket hem süreç arası için aynı kalır.

```text
ana süreç                        işçi (utilityProcess)
  AgentProcess.send()  ──postMessage(NDJSON)──►  parentPort.postMessage
  child.on('message')  ◄──postMessage(NDJSON)──  parentPort.on('message')
```

## Yaşam döngüsü

- `start()` — `utilityProcess.fork()`; `spawn` olayı beklenir.
  - İşçi dosyası yoksa **anlaşılır hata** (`Ajan işçisi bulunamadı: …`).
  - Başlamadan ölürse başlatma sözü reddedilir (asılı kalmaz).
  - 15 sn içinde `spawn` gelmezse zaman aşımı.
- `request(method, payload)` — kimlikli istek; yanıt `id` ile eşleştirilir.
  - Süreç yoksa **otomatik başlatır**.
  - Zaman aşımında bekleyen kayıt temizlenir.
- `ping()` — canlılık turu.
- `stop()` — `shutdown` isteği, ardından `kill()`; çıkış beklenir.
- İşçi `disconnect`/`SIGTERM`/`SIGINT` durumunda kendini kapatır (yetim süreç yok).

## Sınırlar (henüz yok)

- İşçi gerçek ajan işi yapmıyor; yalnızca yaşam döngüsü.
- Ajan hâlâ ana süreçte `runAgent` ile çalışıyor. Devretme sonraki adımda,
  `AgentEventSink` ve `SessionRepository` uzak uygulamalarıyla birlikte.
- İşçi stdio'su varsayılan olarak yutulur (`ignore`); hata ayıklarken
  `inheritStdio: true` kullanın.
- Kısmi çerçeve: `postMessage` tek parça teslim eder, bu yüzden süreç arası
  taşımada çerçeveleyici gerekmez; soket taşımasında gerekir.

## Testler

```bash
npm run build                                     # out/main/agentWorker.js gerekir
node scripts/run-unit.cjs scripts/agent-process-test.ts   # 20 kontrol, gerçek süreç
```

Test gerçek bir `utilityProcess` açar ve şunları doğrular: başlatma, ping/pong,
bilinmeyen yöntem reddi, eşzamanlı isteklerin kimlikle eşleşmesi, düzgün kapanış,
işletim sisteminde süreç kalmaması, otomatik yeniden başlatma, yeniden başlatmada
yeni pid ve eksik işçi dosyasında anlaşılır hata.

`npm run test:unit` bu testi çalıştırırken `out/main/agentWorker.js` yoksa
derlemeyi kendisi tetikler.
