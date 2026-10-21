# Önerilen Yanıtlar

Model bir mesajda kullanıcıdan belirli bir geri bildirim beklediğinde, composer’ın
hemen üstünde **yarı belirgin öneri çipleri** gösterilir.

## Nasıl çalışır?

Son asistan mesajı analiz edilir:

- **Tırnak içinde istenen yanıtlar**:
  - `Bana “bağlandı” yaz`
  - `yaptıysan "yaptım" de`
  - `Reply with "done"`
- **Onay / devam soruları**:
  - `Onaylıyor musun?`
  - `Devam edelim mi?`
  - `Hazır mısın?`
  → `Evet` / `Hayır` önerilir.
- Kod blokları ve markdown işaretleri analizden çıkarılır.
- En fazla 4 öneri gösterilir.

## Kullanım

- **Çip**: Yanıtı composer’a ekler; kullanıcı düzenleyebilir.
- **✓ Onayla ve gönder**: İlk öneriyi doğrudan gönderir.
- **✕**: Önerileri gizler.
- Öneri çubuğu; composer’da yazı varsa, model yanıtı akıyorsa veya onay bekleniyorsa
  görünmez.
- Oturum değişince gizleme durumu sıfırlanır.

## Sınırlar

- Yalnızca **son mesaj asistan mesajıysa** çalışır.
- Tırnak kullanılmayan serbest metinlerden niyet çıkarımı yapılmaz.
- Öneriler modelin metnine dayalıdır; gönderim öncesi kullanıcı kontrol edebilir.
- Doğrudan gönderim, normal mesaj gönderme akışını kullanır (ajan/Çoklu Evren ayarları
  geçerlidir).
