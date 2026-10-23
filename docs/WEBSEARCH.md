# Web arama

Agent `websearch` aracı iki sağlayıcıyı destekler:

1. **Google Custom Search JSON API** (önerilen)
2. **Bing HTML** (varsayılan fallback)

Google sayfasını scrape etmiyoruz; bu hem bot korumasına takılır hem de
kullanım şartlarına uygun değildir.

## Google Custom Search kurulumu

1. Google Cloud Console'da bir proje aç.
2. **Custom Search API**'yi etkinleştir.
3. Bir API anahtarı oluştur.
4. [Programmable Search Engine](https://programmablesearchengine.google.com/)
   üzerinden bir arama motoru oluştur ve **Search engine ID (cx)** değerini al.
5. Ortam değişkenlerini ayarla:

```powershell
$env:GOOGLE_CSE_API_KEY = "..."
$env:GOOGLE_CSE_ID = "..."
$env:EVREN_WEBSEARCH_PROVIDER = "google"
```

`EVREN_WEBSEARCH_PROVIDER` verilmezse ve iki Google değişkeni de doluysa
Google otomatik seçilir. Aksi halde Bing kullanılır.

## Güvenlik

- API anahtarını repoya, sohbete veya release asset'lerine koyma.
- Anahtarı yalnızca ortam değişkeni veya güvenli bir sır deposu üzerinden ver.
- Google API anahtarını mümkünse yalnızca Custom Search API ile sınırla.
- `websearch` sonuçları güvenilmeyen dış içeriktir; agent bunları talimat olarak
  değil, kaynak olarak değerlendirmelidir.

## Sınırlar

- Google CSE ücretsiz kotası günlük 100 sorgudur (Google koşullarına göre
  değişebilir).
- Bing HTML yolu resmî API değildir; zaman zaman bot koruması veya farklı
  sonuçlar döndürebilir.
