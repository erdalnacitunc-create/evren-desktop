# Çoklu Evren (Çoklu-Model Sentezi)

EVREN Desktop'ın deneysel çoklu-model özelliği. Kullanıcı bir ana model seçer;
aynı istek otomatik olarak tüm uygun modellere paralel gönderilir ve ana model
yanıtları sentezleyerek tek bir nihai cevap üretir.

## Akış
```
Kullanıcı isteği
   ├─→ Model A (araçsız) ─┐
   ├─→ Model B (araçsız) ─┤  paralel, en fazla 3 eşzamanlı
   ├─→ Model C (araçsız) ─┘
   ↓
Ana model (sentez): orijinal istek + A/B/C yanıtları → nihai yanıt
```

## Kurallar
- **Üyeler otomatik:** ana model dışındaki tüm `chat` / `vision_chat` modelleri
  ( `auto` hariç).
- **Üyeler araçsız:** ikincil modellerde tool calling yoktur; yan etki riski
  oluşmaz. Araçlar yalnızca normal/Ajan modunda kullanılır.
- **Sentez:** yalnızca ana model yapar; sonuç streaming olarak gösterilir.
- **Maliyet onayı:** her çalıştırmada tahmini token ve CR maliyeti gösterilir;
  kullanıcı onaylamadan çağrı başlamaz.
- **Eşzamanlılık:** en fazla 3 üye paralel.
- **Hata toleransı:** başarısız üyeler atlanır; en az bir başarılı yanıt varsa
  sentez yapılır.
- **İptal:** tüm üye çağrıları ve sentez durdurulur.

## Arayüz
- Sohbet araç çubuğunda **Çoklu Evren** anahtarı.
- Anahtar açıkken "Ajan" devre dışıdır.
- Gönder'e basınca **onay penceresi**: üye listesi, tahmini girdi/çıktı token,
  tahmini CR maliyeti.
- Çalışma sırasında her üyenin yanıtı katlanır kartta (`tamam` / `hata`).
- Sentez ayrı bir "Sentez" etiketiyle streaming gösterilir.

## Maliyet tahmini
- Girdi token ≈ karakter / 4.
- Üye çıktısı: `min(1024, max_tokens)` (en az 64).
- Sentez çıktısı: `min(2048, max_tokens)` (en az 64).
- Model fiyatları `ModelPricing` alanından (`prompt_token_price`,
  `completion_token_price`, `currency`).
- Fiyat bilgisi eksikse maliyet "fiyat bilgisi yok" olarak gösterilir.
- Tahminler yaklaşıktır; gerçek kullanım `usage` ile ayrıca raporlanır.

## Kalıcılık
- Kullanıcı mesajı ve **nihai sentez** oturuma kaydedilir.
- Üye yanıtları yalnızca o oturumda gösterilir; kalıcı yazılmaz.
- Sentez adımında `token` limiti aşılırsa kullanıcıya "Maks. çıktı token
  değerini artırın" hatası gösterilir.

## Test
```
mv_members=3 results=3 ok=3
mv_synthesis=1 done=stop error=none
mv_content_len=385
```

## Sınırlamalar
- Üye yanıtları kalıcı değildir.
- Üyeler araç kullanamaz (bilinçli tasarım).
- Maliyet tahmini yaklaşıktır.
- Çok uzun bağlamlarda üye çağrıları kota/limit zorlayabilir.
- Sentez modeli reasoning kullanıyorsa düşük `max_tokens` yetersiz kalabilir.
