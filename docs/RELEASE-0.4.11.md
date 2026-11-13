# 0.4.11 Beta — çalışma alanı dışı yollar ve Türkçe sınır hatası

0.4.10'daki plc_proje koşunuzu inceledim. **Sonuç en iyisiydi**, ama bir kusur
çıktı.

## Koşu sonuçları: en hızlı ve en temiz

| Sürüm | Süre | Retry | Araç | Alt ajan | Rapor |
|---|---|---|---|---|---|
| 0.4.7 | 21 dk | 4 | 15 | 4 (hepsi boş) | 10 080 kr |
| 0.4.8 | 13 dk | 11 | 12 | 4 (hepsi kısmi) | 6 827 kr |
| **0.4.10** | **5,6 dk** | **0** | **8** | 0 | 3 827 kr |

**%73 daha hızlı, sıfır retry.** Model bu kez alt ajan kullanmadı ve doğru
kararı verdi: 8 `run_command` ile yapıyı çıkardı, 5,6 dakikada bitirdi.
Devretmek bu iş için gereksizdi.

Rapor kalitesi de arttı — model neyi **doğrulamadığını** açıkça yazdı:

> **Doğrulanamayanlar (içerik okuması yapılmadı)**
> Bu özet dizin yapısı, dosya adları, boyutlar, git geçmişi ve dal adları
> üzerinden çıkarıldı. Şunlar içerikten teyit edilmedi: firmware'de gömülü
> Wi-Fi/MQTT/API kimlik bilgisi olup olmadığı, `araclar/.env_ornek` içeriği,
> `supabase/migrations` şema detayları…

Ve devamında alt ajanı **kendisi önerdi**:

> "İstersen bir sonraki adımda sır taraması, veri şeması çıkarımı ve Flutter
> bağımlılık gruplarını **paralel alt ajanlarla** içerikten doğrulayabilirim."

Yani 0.4.5–0.4.9 arası yaptığımız devretme kuralları modele işlemiş.

## Kusur: çalışma alanı dışındaki yollar

Model bir kez `read_file` denedi ve hata aldı:

```
Araç hatası: ENOENT: no such file or directory, stat
'C:\Users\erdal\AppData\Local\Temp\evren-workspaces\mwekjvxv-5e451733\00_genel_felsefe.md'
```

Sebep: çalışma alanı **geçici klasördü**, kullanıcı ise masaüstündeki
`plc_proje` klasörünü sordu. `read_file` göreli yolu çalışma alanına göre çözer
ve **kapsam dışına çıkamaz** (path traversal koruması — bilinçli).

Model PowerShell'e düşüp devam etti. Kayıp: 1 adım + dağınık çıktı. Daha
önemlisi: model bunu **bilmiyordu**, deneyerek öğrendi.

### Düzeltme 1: istem baştan söylüyor

Kullanıcı metninde çalışma alanı dışı bir yol geçiyorsa (sürücü harfi,
`/home/...`, "masaüstü", "belgeler", "indirilenler"…) sistem istemine eklenir:

```
ÇALIŞMA ALANI DIŞI: Kullanıcı çalışma alanı dışında bir yol söyledi.
read_file, list_files, glob, grep ve write_file yalnızca çalışma alanı içinde
çalışır (kapsam dışına erişim güvenlik gereği engellenir).
Çalışma alanı dışındaki dosyaları okumak için run_command kullan ve mutlak yol
ver. Örnek: Get-Content "C:\proje\README.md" -Encoding UTF8.
read_file denemeyin; doğrudan run_command ile ilerleyin.
```

Alt ajanlar için aynı not, görev metninde mutlak yol varsa eklenir.

### Düzeltme 2: hata mesajı eyleme dönük

Önce: `Çalışma alanı dışına erişim engellendi.`
Sonra:
```
Çalışma alanı dışına erişim engellendi. Çalışma alanı dışındaki dosyalar için
run_command + mutlak yol kullan (ör. Get-Content "C:\proje\dosya.md").
```

Böylece model hatayı görünce ne yapacağını biliyor — deneme yanılma yok.

## Yan bulgu: Türkçe `\b` tuzağı tekrar çıktı

Yol tespiti ilk yazdığımda `\bmasaüstü\b` kullandım. **"masaüstü" ile biten
metinde eşleşmedi** — çünkü `ü` JavaScript'te kelime karakteri değil, dolayısıyla
sonda sözcük sınırı oluşmuyor.

Bu tuzağı 0.4.2'de hafıza sınıflandırıcısında yaşamıştık; aynı hata başka bir
modülde tekrar etti. Çözüm: Türkçe sözcüklerde `\b` yerine **kök eşleşmesi**
(`masaüst`, `belge`, `indirilen`) — çekim eklerini de yakalar.

## Google araması sorusuna cevap

**Şu an Google kullanılmıyor.** Kod Google CSE'yi destekliyor ama iki anahtar
gerekiyor ve bunlar tanımlı değil:

```
GOOGLE_CSE_API_KEY: YOK
GOOGLE_CSE_ID:      YOK
etkin zincir:       duckduckgo → bing
gerçek arama:       Arama (DuckDuckGo): "OpenSSL 3.5 release notes" · 5 sonuç
```

Tanımlanırsa zincir otomatik `google → duckduckgo → bing` olur. Anahtarlar
şu an **yalnızca ortam değişkeni** olarak okunuyor; arayüzde alan yok ve
uygulama ortam değişkenlerini kendi başlatmıyor. Bu bir sonraki adım olabilir
(ayarlar ekranına "Google Custom Search" alanı).

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `outside-workspace-hint-test` | 19 | Yol tespiti, Türkçe kök eşleşmesi, metin kalitesi |

Toplam: **60 paket / 1407 kontrol** (önceki 59/1388). typecheck ✓ build ✓ e2e ✓

## Sizin bir sonraki sınamanız

0.4.11'de aynı sorgu şunu yapmalı:

1. `read_file` denemeden doğrudan `run_command` + mutlak yol
2. Aynı hız (5-6 dk) veya daha iyi
3. Kayıp adım olmaması

İsterseniz ikinci adımda modelin önerdiği üçlüyü çalıştırın — sır taraması,
şema çıkarımı, Flutter bağımlılıkları — bu kez alt ajanlar gerçekten iş
yapacak ve 0.4.6–0.4.9 zincirini uçtan uca sınamış oluruz.
