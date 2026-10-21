# Sesli Giriş (Transkripsiyon)

Composer’daki **🎙 Ses** düğmesi mikrofonu açar; kayıt durdurulunca ses
EVREN `/v1/audio/transcriptions` API’sine gönderilir ve metin mesaj kutusuna
eklenir.

## Akış

1. **🎙 Ses** → mikrofon izni istenir.
2. Kayıt başlar; düğme **⏹ Ns** olur.
3. **⏹** → kayıt durur, transkripsiyon başlar (**…**).
4. Dönen metin composer’a eklenir; imleç mesaj kutusuna döner.
5. Maksimum kayıt süresi **120 saniye**; 25 MB üstü ses reddedilir.

## Teknik

- Tarayıcı `MediaRecorder` (WebM/Opus) kullanılır.
- Model otomatik seçilir: `task: audio_transcription` olan ilk model
  (genellikle `qwen3-asr-1.7b`).
- API isteği ana süreçte yapılır; API anahtarı renderer’a verilmez.
- Mikrofon izni yalnızca **audio** için verilir; kamera/video reddedilir.
- İstek `multipart/form-data` + `response_format=json`.

## Sınırlar

- Şu an yalnızca **ses → metin** var; TTS (metin → ses) API’de yok.
- Mikrofon olmayan/izin verilmeyen ortamda düğme hata bildirir.
- WebM/Opus desteklenmezse API hatası kullanıcıya gösterilir.
- Kayıt otomatik olarak gönderilmez; metni gözden geçirip Gönder’e basın.
