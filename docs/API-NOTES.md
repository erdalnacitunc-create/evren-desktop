# EVREN LLM API — Keşif Notları (M0 Recon)

Tarih: 2026-10-18
Kaynak: `https://evren-llmapi.ssyz.org.tr/openapi.json` (OpenAPI 3.1.0, title: "EVREN LLM API", version 0.1.0)
Tam şema: `docs/evren-llmapi-openapi.json`

## Base URL
`https://evren-llmapi.ssyz.org.tr`

## Auth
- OpenAPI'de `securitySchemes` tanımlı DEĞİL.
- Kamu uçları: standart `Authorization: Bearer <API_KEY>` bekleniyor (doğrulanacak — M0 capture ile teyit).
- `/internal/*` uçları AYRICA `X-Delegation-Token` header'ı ister (biz kullanmayacağız; servis-ici).
- API anahtarı resmi panelden alınır: `https://evren.ssyz.org.tr/api-keys` (oturum gerektirir, e-Devlet/SSO).

## Uçlar (public)
| Method | Path | Açıklama |
|--------|------|----------|
| GET  | /healthz | Liveness |
| GET  | /readyz | Readiness |
| POST | /v1/chat/completions | OpenAI Chat Completions (stream destekli) |
| POST | /v1/completions | OpenAI legacy completions |
| POST | /v1/messages | Anthropic Messages (Claude SDK uyumlu) |
| POST | /v1/messages/count_tokens | Anthropic token sayımı |
| POST | /v1/responses | OpenAI Responses API |
| GET/POST/DELETE | /v1/responses/{id}... | Responses durum/input_items |
| POST | /v1/embeddings | Embeddings |
| POST | /v1/rerank | Rerank |
| GET  | /v1/models | Anahtarın erişebildiği modeller |
| POST | /v1/ocr | OCR |
| POST | /v1/systemone, /v1/systemone/batch | EVREN'e özel "SystemOne" |
| POST | /v1/audio/transcriptions | Ses -> metin |
| POST | /v1/media (+complete/abort/finalize, GET status) | Parçalı (multipart/chunked) medya yükleme |
| GET  | /v1/quota | Kota/kredi durumu (CR) |
| GET  | /v1/terms/status \| /v1/terms/text \| /v1/terms/accept | Kullanım şartları akışı |
| GET  | /v1/requests/{request_id} | İstek durum metaverisi (replay yok) |

## Önemli şema özetleri
### ModelInfo (GET /v1/models -> data[])
- `id`, `object:"model"`, `created`, `owned_by:"evren"`
- `task`: `chat | vision_chat | embedding | rerank | ocr | audio_transcription`
- `modalities`: `text|image|audio` dizisi
- `pricing`: `{ prompt_token_price, completion_token_price, currency:"CR", free_until }`
- `context_length`, `default_max_output_tokens`
- `capabilities`: `{ tools, thinking, reasoning_effort, reasoning_effort_values, reasoning_effort_aliases, vision, response_format, seed, top_k, stop }`
- `precision`: örn. `FP8`, `BF16`

### ChatCompletionRequest
- `model` (string), `messages` (array), `stream` (bool)
- `max_tokens`
- `evren_tools` (bool) — EVREN'e özel (araç/agent yeteneği için)

### QuotaStatus (GET /v1/quota)
- `held_cr` (string, HOLD), `remaining_cr` (string, bakiye)
- `used_tokens`, `cap`, `window_minutes`, `reset_at`, `usage_ratio`, `level`: `ok|warn|critical|unknown`
- Günlük: `daily_used_tokens`, `daily_limit_tokens`, `daily_remaining_tokens`, `daily_reset_at` (00:00 UTC)

## Uygulama çıkarımları
1. Tek istemciyle hem OpenAI hem Anthropic SDK'ları desteklenebilir -> adaptör katmanı.
2. Modeller dinamik; fiyat/kota kredisi (CR) gösterimi mümkün.
3. `capabilities` alanları hangi UI kontrollerinin açılacağını belirler (tools/thinking/vision...).
4. Streaming SSE — chat deneyimi için öncelik.
5. Medya yükleme ayrı bir yaşam döngüsü (initiate -> complete -> finalize).

## Açık sorular (capture ile netleştirilecek)
- Kesin auth header biçimi (Bearer mı, X-Api-Key mi?).
- SSE delta şeması ve `evren_tools` davranışı.
- 401/403/429 hata gövdesi biçimi.
- `/v1/models` gerçek model isimleri (anahtarsız alınamıyor).
