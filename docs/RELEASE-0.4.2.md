# 0.4.2 Beta

## Bu sürümde: canlı koşudan çıkan altı düzeltme

Aynı sorgu dört modelle paralel çalıştırıldı (4514 olay, 0 bozuk satır, 4/4
tamamlandı) ve olay günlüğü sonuçlarla karşılaştırıldı. Ayrıntılar
`docs/OPENCODE-PARITY.md` §13-17.

### 1. USB aygıtları artık gerçek ürün adıyla geliyor
`usb_devices` yalnızca Windows `FriendlyName` alanını okuyordu; bileşik
aygıtlarda bu sürücü sınıfıdır, ürün adı değil. Model elinde yalnızca VID/PID
görünce marka uydurdu — `0B05:6206` için "ASIX Ethernet" dedi, gerçekte
C-Media ses kartı.

Artık aygıtın kendi bildirdiği ürün adı ve üretici okunuyor, sürücünün genel
etiketleri filtreleniyor ve modele "tahmin etme" kuralı iletiliyor.

### 2. `powershell -Command "… $_ …"` artık bozulmuyor
Komutlar zaten PowerShell içinde çalışıyor; model tekrar sarmalayınca dış
katman `$_`'yi boşaltıyor ve komut
`The term '.InstanceId' is not recognized` ile düşüyordu (5 araç hatasının 4'ü).
Sarmalayıcı artık çözülüyor, iç betik bir kez ayrıştırılıyor. `-File` ve kısmi
sarmalama etkilenmiyor. Sistem istemine de "komutu sarmalama" kuralı eklendi.

### 3. Yanlış araç adı öneriyle dönüyor
`Bilinmeyen araç: run_code` yerine artık
`… Bunu mu demek istediniz: execute?` deniyor. Takma adlar (`bash`, `read`,
`search` …), normalize eşleşme (`Read_File`), önek ve yazım mesafesi
kullanılıyor. Yeterince yakın değilse öneri yapılmıyor.

### 4. İlerlemesiz döngü yönlendirmesi
Adım sınırı kalktıktan sonra model bazen hiç metin üretmeden araç çağırıyordu
(canlı koşuda 19 dk, 30 araç, `scan_usb.ps1` … `scan_usb6.ps1`).

Son 4 adım metinsiz geçerse modele "bulguları şimdi raporla" hatırlatması
gidiyor. Araç çağrısı **engellenmiyor**; en çok iki hatırlatma yapılıyor
(birincisi yumuşak, ikincisi kesin).

### 5. Hafıza kirliliği: geçici gözlemler kalıcı anı olmuyor
Kök neden bulundu: hafızada **1 Kasım'da kaydedilmiş yanlış** bir kayıt vardı —

> "Bağlı USB aygıtları arasında ASIX Electronics Corp Gigabit Ethernet
> adaptörü (VID_0B05&PID_6206)…"

gemma bu anıyı okuyup aynı yanlışı tekrarladı. Aynı dosyada "bu ortamda kabuk
aracı yok", "TP-Link 4G modem bağlı" gibi başka bayat kayıtlar da vardı.

**Kural:** Hafıza, araçların ucuzca yeniden türetebileceği şeyleri tutmamalı.

- USB envanteri, COM portları, IP/MAC, "şu anda bağlı" durumları, araç
  sürümleri, makineye özgü yollar artık **anı olarak kaydedilmiyor**.
- Eski kayıtlar **silinmiyor** (kullanıcı verisi); `volatile` olarak
  işaretleniyor ve modele `GEÇMİŞ GÖZLEM — doğrula` uyarısıyla veriliyor.
- Geri getirmede bu anılar puan cezası alıyor, kalıcı bilgilerin önüne
  geçmiyor.
- Mevcut hafızanız ilk açılışta otomatik sınıflandırılır; hiçbir anı kaybolmaz.

### 6. Olay günlüğü artık döndürülüyor
`session-events.jsonl` hiç küçülmüyordu (canlı koşuda 4514 olay / 1.1 MB).
8 MB'ı aşınca `session-events.<zaman>.jsonl` olarak arşivleniyor, en yeni
3 arşiv tutuluyor. Döndürme akışı asla durdurmaz.

## Doğrulama
- **46 test paketi / 1012 kontrol** (önceki: 43/922)
- Yeni: anı sınıflandırma 43, hafıza kirliliği uçtan uca 15,
  olay günlüğü döndürmesi 32
- Hafıza testi gerçek kullanıcı dosyasındaki 13 anının metniyle çalıştırıldı:
  5 geçici işaretlendi, "salt-okunur yaklaşım" gibi kalıcı kayıtlar korundu
- typecheck ✓ · build ✓ · e2e ✓

## Bilinen sınırlar
- Kısmi sarmalama (`cd X; powershell -Command "…"`) çözülmüyor; sistem istemi
  bunu önlemeye çalışır.
- Ürün adı yalnızca Windows'ta okunuyor; Linux'ta `lsusb` kullanılıyor.
- İlerleme yönlendirmesi sezgiseldir (4 metinsiz adım); yalnızca hatırlatma
  olduğu için zararsız.
- Geçicilik sınıflandırması sezgiseldir; yanlış pozitif bir kalıcı anıyı
  "doğrula" uyarısıyla işaretleyebilir (silmez).
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir.
