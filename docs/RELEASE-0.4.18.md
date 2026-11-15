# 0.4.18 Beta — koordinasyon da ilerlemedir; alt ajan bütçesi ve kuyruk

Üç fazlı canlı sınama (faz 1 proje incelemesi, faz 2 web araştırması, faz 3
kodlama) 0.4.17 üzerinde koşuldu. Code Mode, bütçe ve dosya sahipliği
düzeltmeleri tuttu; iki yeni kusur ve bir de ölçüm hatası bulundu.

## Kusur 1 — sert eşik koordinasyonu "ilerlemesiz" saydı

Faz 2 günlüğü:

```
[info] adım 8/sınırsız başladı (araç: 11)
[warn] İlerlemesiz döngü: 0 adım metinsiz — yönlendirme #1
```

`0 adım metinsiz` ifadesi çelişkinin kendisiydi: `stalledStreak` son adımda
ilerleme görüyordu, ama yönlendirme yine gönderildi.

Ana ajanın adımları: `spawn_agent` → `spawn_agent` → `task_wait` → `task_wait`
→ `spawn_agent`. Okuma yoktu, metin yoktu — ama **gerçek iş yönetimi** vardı:
ajanlar arka planda çalışıyor, ana ajan onları bekliyor.

Kök neden: sert eşik yalnızca **ham adım sayısına** bakıyordu
(`history.length >= 8` ve hepsi metinsiz). İlerleme olup olmadığını
hesaba katmıyordu.

**Düzeltme:**
1. `StepObservation.coordinationSignals` eklendi. Başarılı `spawn_agent` ve
   anlamlı `task_wait`/`task_status`/`task_list` yanıtı ilerleme sayılır
   (`isCoordinationProgress`).
2. Sert eşik **12 adıma** çıkarıldı ve ek koşul: son **6** adımda taze ilerleme
   (okuma veya koordinasyon) varsa ertelenir. Uzun keşif meşru; yalnızca
   ilerleme gerçekten kuruduysa durdurulur.
3. `stalledStreak` koordinasyonda da durur.
4. Günlük mesajı düzeltildi: `N adım metinsiz` yerine, döngü sert eşikten
   tetiklendiyse `uzun süre metinsiz (toplam N adım, araç M)`.

Sonsuz döngü zaten `MAX_TOOL_CALLS` ile sınırlı; sert eşik son savunma hattı
olarak kaldı ama artık yanlış alarm vermiyor.

## Kusur 2 — alt ajan bütçesi derin incelemede dar kaldı

Faz 1'de **üç ajanın üçü de** kısmi sonuç döndürdü:

```
[budget] akış bütçesi doldu (387 sn) — üretim kesildi
[budget] akış bütçesi doldu (404 sn) — üretim kesildi
```

Zaman araçlarda değildi (araçlar 1-3 sn). Bu sağlayıcıda 4-8 bin karakterlik
rapor tek parçada 200-400 sn üretim demek; okuma turları eklenince 420 sn
dar kalıyor.

**Düzeltme:** varsayılan bütçe **600 sn** (`EVREN_SUBAGENT_DEADLINE_MS` ile
değiştirilebilir). %75 uyarısı daha buyurgan: *"Şimdi araç çağırmayı bırak…
raporu kısa maddeler hâlinde ver… bütçe dolduğunda raporun yarım kalır."*

## Kusur 3 — kuyrukta 5 dakika boşa bekleme

Faz 1'de 4. spawn 300 sn kuyrukta bekledi, sonra reddedildi:

```
Alt ajan reddedildi: Alt ajan sırası zaman aşımına uğradı (kullanılan: 2/6, etkin: …)
```

Model tekrar denedi ve ikinci sefer geçti — yani 5 dakika yalnızca gecikmeydi.

**Düzeltme:** kuyruk zaman aşımı 300 → **90 sn**; ret mesajı artık "hiç açma"
demiyor, *"önce `task_wait` ile çalışanlardan birini al, sonra bu ajanı aç"*
diyor.

## Ölçüm hatası (kendi testimde)

0.4.17 testindeki "okuma sırasında yönlendirme 0" kontrolü **boştu**:
yönlendirme metni `messages` dizisine ekleniyor, olay akışına yayınlanmıyor.
Test `content` olaylarında arıyordu, hiçbir zaman bulamazdı — ve "0" diye
geçti. Artık `main.log` satırlarını zaman penceresiyle sayıyor; kısmi sonuç
sayacı da faz bazına alındı (önceki fazların görevleri karışmıyor).

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `progress-guard-test` | 63 (önceki 44) | Okuma, koordinasyon, sert eşik, taze pencere |
| `agent-subagent-limit-test` | 48 (önceki 46) | Kuyruk zaman aşımı mesajı |
| `subagent-deadline-test` | 12 | Akış bütçesi, kısmi sonuç |
| `code-mode-empty-test` | 17 | Boş Code Mode sonucu |
| `websearch-parse-test` | 86 | Arama |

Toplam: **68 paket / 1657 kontrol**. typecheck ✓ build ✓ e2e ✓

## Üç fazın sonuçları (0.4.17, düzeltme öncesi)

| Faz | Süre | Araç | Alt ajan | Kısmi | Yanıt |
|---|---|---|---|---|---|
| 1 — proje incelemesi | 842 sn | 38 | 2/2 | 1/2 | 10 080 kr |
| 2 — web araştırması | 1096 sn | 56 | 3/4 | 3/4 | 8 283 kr |
| 3 — kodlama | 387 sn | 11 | 2/2 | 0/2 | 305 kr |

Faz 3'te iki hata da düzeltildi, `files` sahipliği doğru dağıtıldı
(`src/sicaklik.ts` / `src/nem.ts`), çakışma reddi çalıştı.

## Bilinen sınırlar

- Faz 1 ve 2'de alt ajanların hâlâ bir kısmı bütçeye takılabilir; kısmi sonuç
  `task_continue` ile tamamlanabilir (faz 2'de model bunu iki kez kullandı).
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
