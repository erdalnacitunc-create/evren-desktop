# MCP Desteği

EVREN Desktop, MCP (Model Context Protocol) sunucularını **araçlar**, **kaynaklar**,
**promptlar**, **elicitation** ve **görevler** ile destekler. Sunucular global
uzantı olarak kurulur: **Ayarlar > Uzantılar > MCP'ler**.

## Bağlantı

- Yerel: `stdio` (komut + argümanlar + ortam).
- Uzak: Streamable HTTP + OAuth (loopback callback, DPAPI token).
- Bağlantıda sunucunun yetenekleri okunur:
  - `tools` → araç sayısı
  - `resources` → kaynak ve kaynak şablonu sayısı
  - `prompts` → prompt sayısı
  - `tasks` → görev desteği
- Sayfalama (`nextCursor`) kaynak/prompt listelerinde desteklenir (10 sayfaya kadar).

## Ayarlar > MCP tarayıcısı

### Kaynaklar
- Bağlı sunucuların kaynakları ve `uriTemplate` şablonları listelenir.
- Bir kaynağa tıklayınca `resources/read` çağrılır; metin önizlenir.
- Şablon kaynaklarda URI istenir; `{id}` gibi değişkenler doldurulur.
- Metin **Kopyala** veya **Composer'a ekle** ile sohbete taşınır.
- İkili (blob) kaynaklar önizlenmez; ajan `mcp_read_resource` aracıyla okuyabilir.
- Metin 200.000 karakterde, blob 1.5 MB'ta kısaltılır.

### Promptlar
- `prompts/list` ile listelenir; başlık/açıklama gösterilir.
- Argümanlar form olarak sunulur; `prompts/get` çağrılır.
- Dönen mesajlar rol etiketiyle önizlenir.
- **Composer'a ekle** ile metin mevcut mesaj kutusuna eklenir (Ayarlar'ı kapatıp
  gönderebilirsiniz).

### Araçlar
- `tools/list` ile listelenir; seçilen araç için JSON argüman editörü açılır.
- Şemadaki varsayılanlar/tipler ile örnek JSON üretilir.
- **Aracı çalıştır** doğrudan `tools/call` yapar.
- Görev destekli sunucularda **"Uzun iş olarak MCP görevi başlat"** seçeneği vardır.
- Araç çıktısı önizlenir ve kopyalanabilir.
- Bu panel manuel/ileri düzey kullanım içindir; ajan araçları normal akışta
  otomatik keşfedilir.

### Görevler
- `tasks/list` ile görevler ve durumları listelenir (10 saniyede bir yenilenir).
- `tasks/cancel`, `tasks/result` desteklenir.
- Görev oluşturma: araç çağrısında `task: true` (panel veya ajan meta-aracı).
- Ajan tarafında `mcp_task_list`, `mcp_task_result`, `mcp_task_cancel` araçları
  ve `mcp_*_call` içinde `task` parametresi bulunur.

## Elicitation

Sunucu `elicitation/create` gönderdiğinde uygulama üstte bir onay penceresi açar.

- **Form modu:** `requestedSchema` alanlarından metin, sayı, boolean, enum ve çoklu
  seçim alanları üretilir. Zorunlu alanlar doğrulanır.
- **URL modu:** mesaj ve bağlantı gösterilir; kullanıcı bağlantıyı açar ve
  **Tamamlandı** der.
- **Reddet / Vazgeç** sonuçları sunucuya `decline` / `cancel` olarak döner.
- 5 dakika yanıt gelmezse istek otomatik `decline` olur.
- Yanıtlar yalnızca isteği yapan MCP sunucusuna döner; başka sunucuya gitmez.
- Elicitation **kullanıcı onayı olmadan** yanıtlanmaz.

## Ajan araçları

MCP bağlıyken modele şunlar eklenir:

- Sunucu araçları (doğrudan veya `mcp_<sunucu>_list_tools/describe_tool/call` meta
  araçları; 80+ araçta meta mod).
- `mcp_list_resources`, `mcp_read_resource`
- `mcp_task_list`, `mcp_task_result`, `mcp_task_cancel`

Kategori `mcp` olduğundan mevcut izin politikasına tabidir.

## Sınırlar

- Kaynak abonelikleri (`resources/subscribe`) ve `resources/updated` bildirimleri
  henüz kullanılmıyor; liste **Yenile** ile güncellenir.
- Prompt içeriğindeki görsel/ses parçaları metin olarak etiketlenir.
- Görev sonuçları araç görevleri için `CallToolResult` şemasıyla okunur.
- Elicitation URL modunda tarayıcı adımının tamamlandığı otomatik doğrulanmaz;
  kullanıcı onayı gerekir.
- MCP sunucusu başına tek bağlantı tutulur.

## Test

Geliştirme sırasında `stdio` tabanlı bir test sunucusuyla doğrulandı:

- kaynak listesi/okuma + şablon
- prompt listesi/getirme
- elicitation formu (ad + enum renk) → araç sonucu
- araç listesi/çağrısı
- görev oluşturma, listeleme, iptal, sonuç
