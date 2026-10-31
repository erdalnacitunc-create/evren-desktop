# Taşıyıcı protokolü

Ana süreç ile (gelecekteki) ajan süreci arasındaki mesaj katmanı.
Henüz bir süreç yok; protokol saf ve test edilebilir durumda, böylece
`utilityProcess` hayata geçtiğinde taşıma katmanı hazır olacak.

Kod: `src/main/transport/protocol.ts`

## Çerçeveleme

Her mesaj **tek satır JSON** (NDJSON):

```json
{"v":1,"kind":"request","id":"req-1","method":"runAgent","payload":{...}}\n
```

- Satır sonu çerçeve sınırıdır; içerikteki `\n` JSON kaçışıyla taşınır.
- `createFramer()` parçalı gelen baytları biriktirir ve tam satırları
  döndürür; yarım satır `pending()` içinde kalır.
- Boş satırlar yok sayılır.
- Tek çerçeve üst sınırı **8 MB**.

## Mesaj alanları

| Alan | Zorunlu | Anlam |
|---|---|---|
| `v` | ✅ | Protokol sürümü (şu an `1`) |
| `kind` | ✅ | `request`, `response`, `event`, `cancel`, `ping`, `pong`, `error` |
| `id` | ✅ | İstek/eşleştirme kimliği (en fazla 200 karakter) |
| `method` | — | Yöntem adı (yalnızca `request`/`response`) |
| `payload` | — | JSON ile serileşebilir yük |

## Reddedilen çerçeveler

`decodeMessage()` aşağıdaki durumlarda `{ ok: false, error }` döner ve
sessizce yorumlamaz:

| Kod | Neden |
|---|---|
| `empty` | Boş satır |
| `bad-json` | Geçersiz JSON |
| `bad-shape` | Dizi/sayı/null gibi nesne olmayan değer |
| `bad-version` | `v` yok veya `1` değil |
| `bad-kind` | Bilinmeyen mesaj türü |
| `bad-id` | Kimlik yok, boş veya 200 karakterden uzun |
| `bad-method` | `method` dize değil |
| `too-large` | Çerçeve 8 MB'tan büyük |

## Kimlik doğrulama

```js
const verdict = authorizeToken(expectedToken, {
  authorization: 'Bearer abc…'      // veya
  'x-evren-token': 'abc…'
})
```

- Karşılaştırma **sabit zamanlı** (`crypto.timingSafeEqual`).
- `expected` boşsa `no-token` ile **kapalı devre** reddedilir — yapılandırma
  hatası asla "herkese açık" anlamına gelmez.
- Başlık yoksa `missing`, eşleşmiyorsa `invalid`.
- `generateToken()` 32 baytlık hex token üretir.

> Not: mevcut `headless.ts` tokeni düz `===` ile karşılaştırıyor. Yeni
> protokolde sabit zamanlı karşılaştırma kullanılıyor; `headless.ts`'e
> geçiş ayrı bir iş olarak duruyor.

## Testler

```bash
node scripts/run-unit.cjs scripts/transport-protocol-test.ts   # 49 kontrol, saf
node scripts/run-unit.cjs scripts/transport-socket-test.ts     # 15 kontrol, gerçek TCP
```

Soket testi gerçek bir sunucu açar ve şunları doğrular: doğru tokenla
istek/yanıt, yanlış tokenla bağlantının kapanması, akış olaylarının sırası,
iki istemcinin bağımsızlığı ve 200 KB'lık yükün parçalanmadan dönmesi.

## Sırada (10b)

1. `utilityProcess.fork()` ile ajan süreci
2. Ana süreçte taşıyıcı sunucu (yalnızca `127.0.0.1`, rastgele port)
3. `AgentEventSink` ve `SessionRepository` için uzak uygulamalar
4. Onay/soru köprülerinin taşınması
5. Kapanış: süreç bittiğinde bekleyen isteklerin reddedilmesi
