---
name: usb-inventory-triage
description: USB/COM cihaz envanterini toplar ve yalnızca doğrulanmış ürün adlarıyla raporlar. Donanım tarama sorularında kullan.
whenToUse: Kullanıcı bağlı USB cihazları, seri portlar veya mikrodenetleyici kartları hakkında soru sorduğunda.
category: read
version: 1
---

# USB envanteri triyajı

> Bu dosya bir **şablon**dur. Otomatik üretilen taslaklar bu biçimde
> `SKILL.draft.md` olarak karantinaya yazılır ve kullanıcı onaylayana kadar
> katalogda görünmez.

## Ne zaman kullanılır

Kullanıcı "bağlı cihazlar", "COM portları", "USB taraması", "hangi kart takılı"
gibi bir soru sorduğunda. Kod değişikliği gerektiren işlerde kullanılmaz.

## Adımlar

1. `usb_devices` aracını **bir kez** çağır. Sonuç zaten cihaz, seri port, disk,
   ADB ve Python/esptool durumunu içerir.
2. Ürün adı alanı boş olan cihazlar için **marka/model tahmin etme**.
   "Ürün adı bildirilmedi" yaz.
3. Hafızada veya geçmiş kayıtlarda aynı VID/PID için farklı bir marka geçiyorsa
   **çelişkiyi belirt** ve araç sonucunu esas al.
4. Yalnızca kullanıcı istediyse derinleştir (seri port okuma, esptool chip-id).
   Aksi hâlde salt-okunur kal.

## Çıktı biçimi

```text
Seri portlar: <sayı>
- <port> — <ürün adı>

Cihazlar: <sayı>
- <ürün adı> (VID:PID) — <durum>

Doğrulanamayanlar:
- <VID:PID>: ürün adı bildirilmedi
```

## Yasaklar

- Ayar değiştiren komut çalıştırma (etkinleştirme, sürücü yükleme, format).
- Başka bir cihazın adını tahmin ederek yazma.
- Aynı taramayı iki kez yapma; sonuç 60 saniyeden yeni ise yeniden taramak
  yerine önceki sonucu kullan.
