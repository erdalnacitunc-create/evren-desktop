# Headless API, SDK ve ACP

EVREN Desktop iki dış entegrasyon sunar:

1. **Yerel Headless HTTP API** — OpenAI uyumlu proxy + oturum uç noktaları.
2. **ACP (Agent Client Protocol)** — Zed vb. editörlerin ajanı stdio üzerinden
   çalıştırması için köprü.

## Headless API

### Etkinleştirme

**Ayarlar > API**:

- **Sunucuyu etkinleştir** + port (varsayılan `45871`).
- Sunucu yalnızca `127.0.0.1` üzerinde dinler.
- Token otomatik üretilir ve **DPAPI** ile saklanır. Panelde göster/kopyala/yenile.
- Uygulama yeniden açıldığında ayar etkinse sunucu otomatik başlar.

### Kimlik doğrulama

`/health` dışındaki tüm `/v1/*` istekleri:

```http
Authorization: Bearer <token>
```

veya `x-evren-token: <token>`. Token olmadan `401`.

### Uç noktalar

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| GET | `/health` | Sağlık kontrolü; auth yok. |
| GET | `/v1/models` | Model listesi (EVREN API proxy). |
| POST | `/v1/chat/completions` | OpenAI uyumlu sohbet; `stream:true` SSE. |
| POST | `/v1/messages` | Anthropic Messages proxy. |
| POST | `/v1/responses` | OpenAI Responses proxy. |
| POST | `/v1/embeddings` | Embedding proxy. |
| GET | `/v1/sessions` | Kayıtlı oturumlar. |
| POST | `/v1/sessions` | `{ "model": "..." }` ile yeni oturum. |
| GET | `/v1/sessions/:id` | Oturum + mesajlar. |
| DELETE | `/v1/sessions/:id` | Oturumu sil. |

Diğer `/v1/*` yolları şeffaf proxy edilir. İstek gövdesi, `Accept`,
`Content-Type`, `anthropic-version`, `anthropic-beta` ve `openai-beta` korunur.
EVREN API anahtarı istemciye verilmez; yalnızca ana süreçte eklenir.

### Örnek (curl)

```bash
curl http://127.0.0.1:45871/v1/chat/completions \
  -H "Authorization: Bearer $EVREN_HEADLESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma-4-31b","messages":[{"role":"user","content":"Merhaba"}],"stream":false}'
```

### OpenAI SDK

```js
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:45871/v1',
  apiKey: process.env.EVREN_HEADLESS_TOKEN
})

const stream = await client.chat.completions.create({
  model: 'gemma-4-31b',
  messages: [{ role: 'user', content: 'Merhaba' }],
  stream: true
})
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '')
}
```

### JavaScript SDK

Dosya: `sdk/evren-client.mjs` (bağımlılık yok, Node 18+ `fetch`).

```js
import { EvrenClient } from './sdk/evren-client.mjs'

const client = new EvrenClient({
  baseUrl: 'http://127.0.0.1:45871',
  token: process.env.EVREN_HEADLESS_TOKEN
})

const models = await client.models()
for await (const text of client.stream(
  [{ role: 'user', content: 'Merhaba' }],
  { model: models[0].id }
)) {
  process.stdout.write(text)
}
```

`chat()`, `models()`, `health()`, `sessions.list/create/get/delete` bulunur.

## ACP

ACP, editör ile ajan arasında JSON-RPC 2.0 tabanlı bir protokoldür. EVREN Desktop
ACP v1'in şu bölümlerini destekler:

- `initialize`, `authenticate`
- `session/new` (`cwd` çalışma alanı olarak kullanılır)
- `session/prompt`
- `session/cancel`
- `session/set_mode` (no-op)
- `session/update`: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
  `tool_call_update`
- `session/request_permission` (araç izinleri)

### Neden köprü?

Windows'ta Electron GUI süreci stdin'i güvenilir okumaz. `acp/evren-acp-bridge.cjs`:

- Node süreci olarak ACP stdin/stdout'unu yönetir,
- rastgele bir yerel TCP portu seçer,
- rastgele token ile Electron `--acp` sürecine bağlanır,
- iki yönlü NDJSON akışını köprüler.

### Zed / ACP istemcisi yapılandırması

```json
{
  "command": "node",
  "args": ["C:\\path\\to\\evren-desktop\\acp\\evren-acp-bridge.cjs"],
  "env": {
    "EVREN_ACP_MODEL": "deepseek-v4-flash"
  }
}
```

Paketlenmiş sürüm için `EVREN_ACP_ELECTRON` ile uygulama çalıştırılabilirini
belirtin:

```powershell
$env:EVREN_ACP_ELECTRON='C:\Program Files\EVREN Desktop\EVREN Desktop.exe'
node acp\evren-acp-bridge.cjs
```

### Davranış

- `session/new` içindeki `cwd` gerçek çalışma alanı kökü olur; dosya/komut/Git
  araçları bu dizine sınırlanır.
- Model: `session/new._meta.model` → `EVREN_ACP_MODEL` → ilk sohbet modeli.
- Her prompt EVREN oturumuna kaydedilir (`ACP: <klasör>` başlığı).
- Araç izinleri ACP istemcisine `session/request_permission` ile sorulur.
  `allow_once`, `allow_always`, `reject_once` seçenekleri sunulur.
- İptal (`session/cancel`) çalışan modeli ve araçları durdurur; yanıt
  `{ stopReason: "cancelled" }` olur.
- İzin isteği 5 dakika yanıtsız kalırsa reddedilmiş sayılır.

### Sınırlar

- `session/load` desteklenmez (`loadSession:false`).
- `session/list` / `session/delete` ACP üzerinden sunulmaz.
- Görsel/ses prompt içeriği metne dönüştürülmez; not olarak geçilir.
- MCP sunucuları ACP `mcpServers` alanından alınmaz; uygulamadaki global MCP
  uzantıları kullanılır.
- ACP ayrı bir Electron sürecidir; aynı anda açık GUI ile ortak oturum dosyasını
  kullanır. Uzun ACP çalışmalarında GUI'yi kapatmanız önerilir.

## Güvenlik

- Headless API yalnızca loopback; token DPAPI ile şifreli.
- API anahtarı istemcilere gönderilmez.
- ACP köprüsü rastgele token + loopback TCP kullanır.
- `--acp` modunda pencere/CSP/tray yüklenmez; yalnızca ajan çalışır.
- ACP araçları çalışma alanı sınırı ve `.git` korumasına tabidir.
- Tüm istekler yerel makineden gelir; EVREN API'sine TLS ile gidilir.
