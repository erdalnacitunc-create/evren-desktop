# 0.4.4 Beta

## Bu sürümde: adım sınırı turunda kaybolan nihai yanıt

### Bulgu

1 Kasım günlüğünde şu hata vardı:

```
Nihai yanıt isteği başarısız (max-steps): Error: `tools` must not be an empty
array. Either provide at least one tool or omit the field entirely.
```

Adım sınırına takılan bir koşuda modelin **kendi** nihai sentezi kayboluyor,
yerine jenerik bir özet yazılıyordu ("Adım sınırına ulaştım (20 adım)…").

### Neden görünmedi

Adım sınırı 0.4.0'da varsayılan olarak kaldırıldı. Hata, `agent.steps`
ayarlanınca ya da araç sınırına çarpılınca geri gelirdi.

### Düzeltme

Son turda araç tanımları artık **dolu** gönderiliyor ve çağrı
`tool_choice: 'none'` ile engelleniyor. Boş dizi hiç gönderilmiyor — bazı
sağlayıcılar onu reddediyor.

Bu, normal döngüdeki sınır turunda zaten kullanılan yaklaşımın aynısı; iki yol
artık tutarlı.

### Yan bulgu: test yanlış davranışı sabitlemişti

`max-steps-test` "araçsız tur"u boş `tools` dizisi olarak tanımlıyor ve 22
istek bekliyordu. Gerçek akış: model sınır turunda metin yazarsa 21 istekte
biter ve `finalizeRun` hiç çağrılmaz. Test bu akışa göre güncellendi; hem
"metin geldi" hem "yedek özet" senaryosu korundu.

## Canlı doğrulama: dört model (0.4.3)

Aynı USB sorgusu dört modelle çalıştırıldı: **1726 olay, 0 bozuk satır,
4/4 tamamlandı, 17 araç sonucu, 0 başarısız.**

### Kalıcı retry ilk kez canlıda doğrulandı

glm oturumu `Model şu anda dolu` (429) aldı:

| Alan | Değer |
|---|---|
| retry olayı | 21:49:05 |
| asistan mesajı `createdAt` | **21:49:05** |
| akış bitişi | 21:51:16 |

Yer tutucu tam retry anında açılmış. 0.4.3 öncesi mesaj akış bitişinde
oluşurdu, yani retry bilgisi hiç yazılmazdı. Başarıdan sonra temizlenmiş.

### Hafıza uyarısı çelişkileri yakalattı

Donanım değişmişti (COM5 yok, modem takılı değil). Hafızadaki eski kayıtlar
`volatile` işaretli olduğu için modeller fark edip araç sonucunu esas aldı:

> "Eski anıdaki gibi üçüncü port (COM5) yok → güncel durumda 2 port."
> "Bu envanterde ASIX Ethernet adaptörü olarak kayıtlıydı; güncel durumda
> Ethernet değil, ses aygıtı → eski anı geçersiz."

17 araç çağrısının **hiçbiri** PowerShell ile sarmalanmamış.

## Doğrulama
- **48 test paketi / 1032 kontrol** (önceki: 47/1023)
- Yeni: `finalize-tools-test` — sahte sağlayıcı boş `tools` dizisine gerçek
  sağlayıcı gibi 400 döner
- typecheck ✓ · build ✓ · e2e ✓

## Bilinen sınırlar
- Adım sınırı varsayılan olarak kapalı; bu yüzden bu yol yalnızca
  `agent.steps` veya araç sınırı ile tetiklenir.
- Hafızadaki 6 geçici anı hâlâ duruyor (silinmiyor, uyarıyla veriliyor);
  isterseniz arayüzden silebilirsiniz.
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir.
