# Gizlilik Politikası / Privacy Policy

EVREN Desktop açık kaynak bir masaüstü uygulamasıdır. Bu politika, uygulamanın
hangi verileri işlediğini açıklar.

## Toplanan veriler

EVREN Desktop kendi sunucularında kullanıcı verisi toplamaz, telemetri göndermez
ve reklam/analitik SDK'ları içermez.

### API anahtarı

- Kullanıcı tarafından girilen EVREN API anahtarı yalnızca cihazda saklanır.
- Windows'ta DPAPI, Linux'ta işletim sisteminin güvenli saklama servisi
  (ör. libsecret/keyring) kullanılır.
- Anahtar yalnızca EVREN LLM API'sine (`evren-llmapi.ssyz.org.tr`) yapılan
  isteklerde kullanılır.
- Anahtar kaynak kodda, repoda veya paket içinde yer almaz.

### Sohbetler ve hafıza

- Sohbet oturumları, hafıza kayıtları, zamanlanmış görevler ve alt-ajan görevleri
  kullanıcı profilinde yerel dosyalarda saklanır.
- Bu veriler kullanıcı silene kadar cihazda kalır.
- Hafıza özelliği kapatılabilir.

### GitHub entegrasyonu

- GitHub OAuth token'ı veya GitHub App private key'i yalnızca cihazda DPAPI ile
  saklanır.
- Token'lar GitHub API'sine (`api.github.com`) istek göndermek için kullanılır.
- GitHub App installation token'ı bellekte tutulur ve süresi dolunca yenilenir.

### Ağ bağlantıları

Uygulama yalnızca kullanıcı eylemleriyle şu uç noktalara bağlanabilir:

- EVREN LLM API (`evren-llmapi.ssyz.org.tr`)
- GitHub (`github.com`, `api.github.com`, `codeload.github.com`)
- Kullanıcının yapılandırdığı MCP sunucuları
- Yerel `127.0.0.1` headless API / ACP köprüsü
- Güncelleme kontrolü için GitHub Releases

## Üçüncü taraflar

- Model çıktıları EVREN LLM API tarafından işlenir; bu hizmetin kendi gizlilik
  koşulları geçerlidir.
- MCP sunucuları kendi veri politikalarına sahiptir.
- GitHub entegrasyonu GitHub'ın gizlilik politikasına tabidir.

## Veri silme

- API anahtarı: Ayarlar → Anahtarı sil.
- Sohbetler: oturum silme.
- Hafıza: Hafıza panelinden temizleme.
- GitHub: Ayarlar → GitHub → Bağlantıyı kes.
- Tüm yerel veriler: kullanıcı profil dizinindeki uygulama klasörünü silmek.

## Çocuklar

Uygulama çocuklara yönelik değildir ve bilerek çocuk verisi toplamaz.

## İletişim

Sorular için GitHub üzerinden issue açabilirsiniz:

https://github.com/erdalnacitunc-create/evren-desktop/issues

## Değişiklikler

Bu politika gerektiğinde güncellenir; değişiklikler repoda yayımlanır.
