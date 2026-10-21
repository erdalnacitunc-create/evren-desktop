# Anlamsal Kod İndeksi (code_search)

Repo map yapıyı gösterir; anlamsal kod indeksi ise **doğal dil sorgusuyla** ilgili
kod parçalarını bulur. EVREN embedding modeli (`qwen3-embedding-8b`) kullanılır.

## Kullanım

1. **Dosyalar > Ara** sekmesini açın.
2. **İndeks oluştur** düğmesine basın.
   - Kaynak dosyalar 60 satırlık, 12 satır örtüşmeli parçalara ayrılır.
   - En fazla 500 dosya / 600 parça indekslenir.
   - Her parça embedding API’sine gönderilir.
3. İndeks hazır olduktan sonra arama kutusuna doğal dil yazın:
   - “kullanıcı kimlik doğrulama akışı”
   - “ödeme kartı işlemi”
   - “config yükleme hatası”
4. Sonuçlar `dosya:başlangıç-bitiş`, benzerlik skoru ve kod önizlemesiyle listelenir.

## Ajan aracı

`code_search`:

```json
{ "query": "kullanıcı oturumu doğrulama", "top_k": 8 }
```

- Yalnızca daha önce indeks oluşturulmuşsa çalışır.
- İndeks yoksa ajan kullanıcıyı **Dosyalar > Ara** panelinden indeks oluşturmaya
  yönlendirir.
- Plan modunda da kullanılabilir (salt-okunur).

## Depolama / gizlilik

- İndeks `%APPDATA%\evren-desktop\code-index\<hash>.json` altında **yerel** saklanır.
- İndeksleme sırasında kod parçaları embedding için EVREN API’sine gönderilir;
  panelde bu uyarı gösterilir.
- İndeks dosyası kullanıcı verisi altındadır; başka bir makineye otomatik gönderilmez.

## Sınırlar

- İndeks statiktir; dosyalar değişince **İndeks oluştur** ile yenilenmelidir.
- Yalnızca kaynak dosya uzantıları ve 512 KB altı dosyalar indekslenir.
- `node_modules`, `.git`, `dist`, `out`, `build`, `target`, `vendor` atlanır.
- Kod parçaları satır bazlıdır; AST/embedding hibrit sıralama henüz yok.
- Çok büyük projelerde ilk indeksleme birkaç dakika sürebilir.
