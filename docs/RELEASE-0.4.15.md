# 0.4.15 Beta — web araması onarımı, alt ajan bütçesi, yinelenen rapor

0.4.14 canlı koşusunda üç kusur bulundu ve düzeltildi.

## 1. `websearch` fiilen çalışmıyordu

Canlı koşu: **15 aramanın 9'u başarısız**, 2'si alakasız
("Cleveland doğum hasarı avukatı"). Model arama yerine GitHub API + resmî
dokümanlara geçmek zorunda kaldı.

Ölçülen kök nedenler (14 Kasım 2026, bu ağ, gerçek sorgu):

| Uç | Ölçüm |
|---|---|
| DuckDuckGo HTML | **HTTP 202** + captcha sayfası (rate-limit) — 6/15'te çalıştı |
| Bing HTML (bizim URL: `&count=&setlang=&cc=`) | HTTP 200, 97 KB, **`b_algo=0`** — JS kabuğu |
| Bing HTML (parametresiz) | HTTP 200, `b_algo=10` ama **başka sorgunun sonucu** ("Lidl mağaza bulucu", "Esther D'Aoust") |
| Mojeek / Startpage / Yandex / SearXNG | captcha / Anubis |
| Brave / Ecosia | 429 / 403 |
| **Google News RSS** | **HTTP 200, ilgili sonuçlar** (Hackaday, Hackster.io) |

### Düzeltmeler

1. **Bing URL'si sadeleştirildi** — `count/setlang/cc` parametreleri
   sonuçları öldürüyordu.
2. **Alaka süzgeci (`gradeHits`)** — sağlayıcı "sonuç var" diye kabul
   edilmiyor: sorgu sözcüklerinin en az %50'si sonuçlarda geçmeli. Çöp
   sayfalar (Bing'in başka sorgu yanıtları) **reddedilir**.
3. **Bot koruması tespiti (`looksBlocked`)** — 202/403/429/captcha/Anubis
   "sonuç yok" değil **"engellendi"** sayılır; sağlayıcı 5 dakika atlanır.
   Aynı oturumda bloklu sağlayıcıyı tekrar denemek 9/15 hatanın ana
   nedenleriydi.
4. **Google News RSS yedeği** — HTML kazıma bloklandığında çalışan son
   halka.
5. **Sağlayıcı hafızası** — son başarılı sağlayıcı sonraki aramalarda öne
   alınır.
6. **Türkçe sorgu istisnası** — Türkçe sözcükler İngilizce sonuçlarda
   geçmez; alaka süzgeci bu durumda uygulanmaz (aksi hâlde her Türkçe arama
   boş dönerdi). Eşik geçilemezse en yüksek uyumlu küme "düşük uyum" notuyla
   döner.

### Canlı doğrulama

`websearch-live-test` (gerçek ağ, 14 kontrol): daha önce başarısız olan
sorgular dâhil 3/3 sorgu **ilgili** sonuç verdi, çöp yok.

## 2. Alt ajan süre bütçesi uygulanmıyordu

İki explore ajanı **482 ve 575 sn** sürdü; bütçe 210 sn'ydi.

| Ajan | Toplam | Araç toplamı | Son adım |
|---|---|---|---|
| `sub-d3637d26` | 482 sn | ~15 sn | **291 sn** tek üretim |
| `sub-da61ab35` | 575 sn | ~10 sn | **423 sn** tek üretim |

Zaman araçlarda değil, model üretimindeydi. `DEADLINE_MS` yalnızca adım
başında kontrol ediliyordu — tek uzun üretimi kesemiyordu.

### Düzeltmeler

1. Bütçe **akışa** uygulanır: her LLM çağrısına kalan süre
   `totalTimeoutMs` olarak geçer.
2. Süre dolunca üretim kesilir ve elindeki metin **kısmi sonuç** olarak döner
   (`partial: true`, `partialReason: 'deadline'`, `task_continue` önerisi).
3. Varsayılan bütçe **420 sn** (`EVREN_SUBAGENT_DEADLINE_MS` ile
   değiştirilebilir) — gözlenen uzun koşuları kapsar, sonsuz kaçışı engeller.
4. Bütçenin %75'inde modele **toparlama hatırlatması** gider, böylece kesinti
   yarım cümleyle değil düzenli bir raporla olur.

### Kanıt

`subagent-deadline-test`: yavaş akan sahte sağlayıcı, 9 sn bütçe →
**41 sn yerine 9 sn**, `partial=true`, içerik korunmuş, günlükte "akış bütçesi
doldu" kaydı var.

## 3. Yanıtta rapor iki kez yazılıyordu

Alt ajan bitince gelen bildirim turu devam ettiriyordu (doğru), ama model
raporu **baştan yazıyordu**: 9,2k kr taslak + 19,5k kr birleşik rapor aynı
yanıtta.

Bildirim metni ve sistem istemi değişti: *"Bu bir hatırlatmadır, yeni bir
görev değildir. Yanıtını baştan yazma: yalnızca yeni bulguları ekleyecek kısa
bir bölüm ekle ve çelişki varsa düzelt."*

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `websearch-parse-test` | 86 | Ayrıştırma, RSS, alaka, bot tespiti, hafıza, sıra |
| `websearch-live-test` | 14 | Gerçek ağ, daha önce başarısız sorgular |
| `subagent-deadline-test` | 12 | Akış bütçesi, kısmi sonuç, günlük |
| `subagent-log-test` | 21 | Yapılandırılmış izleme |
| `subagent-wait-test` | 21 | Bekleme/devam/bildirim |

Toplam: **67 paket / 1605 kontrol** (önceki 66/1553). typecheck ✓ build ✓ e2e ✓

## Bilinen sınırlar

- Arama sağlayıcıları ağ/IP'ye göre değişir; bu ağdan DuckDuckGo aralıklı
  olarak 202 döndürüyor. Zincir + RSS yedeği bunu tolere eder ama garanti
  etmez. Google CSE anahtarı en güvenilir yol olmaya devam ediyor.
- Alt ajan bütçesi 420 sn; çok daha derin araştırma gerekiyorsa
  `task_continue` ile sürdürülür.
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
