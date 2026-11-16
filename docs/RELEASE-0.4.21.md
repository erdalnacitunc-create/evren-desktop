# 0.4.21 Beta — hız: alt ajan paralelliği, ön okuma, prompt önbelleği

0.4.20 ölçümü darboğazı netleştirdi: **adım başına 88 sn**, araç payı **<%2**,
gerçek hız ancak adım sayısını azaltmak veya girişi önbelleğe aldırmakla gelir.
Bu sürüm üç kaldıracı da uygular.

## Adım 1 — alt ajan içinde paralel araç

`subagent.ts` araçları **sırayla** çalıştırıyordu (`for (const call of ...)`);
en yavaş ajanlar 20 adımda bu yüzden bekliyordu.

Artık iki fazlı:
1. **Hazırlık (sıralı):** izin ve onay kontrolleri. Kullanıcı etkileşimi
   sıralı olmak zorunda.
2. **Yürütme (paralel):** onaylanmış **salt-okunur** çağrılar donanım
   profilinin sınırıyla eşzamanlı (`toolRunner`). Aynı adımda yazma/`execute`
   varsa **hepsi seri** — yarış koşulu yok.

Kanıt (`subagent-parallel-e2e-test`): günlükte
`[explore/sub-parallel/step] paralel araç: 3 çağrı · 3 eşzamanlı`.

## Adım 2 — ön okuma (warm start)

Ajan "listele → tek tek oku → daralt" turlarında 2-5 adım harcıyordu. Her adım
60-90 sn. Artık istemde adı geçen ve `files` sahipliğinde verilen dosyalar
**ajan başlamadan** okunup bağlama konur:

- `extractCandidates()` — istemdeki uzantılı yolları ve sahiplik listesini çıkarır
- `prefetchFiles()` — en fazla 8 dosya, profil paralelliğiyle, toplam 60 kB /
  dosya başına 20 kB bütçeyle
- `appendPrefetch()` — gerçek bir araç turu gibi `assistant(tool_calls)` +
  `tool(result)` çiftleri ekler
- İsteme not düşülür: *"Bu dosyaları tekrar okumaya çalışma, doğrudan analize geç."*

Yalnızca **salt-okunur** ajanlarda; çalışma alanı dışına çıkmaz
(`resolveInside`). Ön okuma arayüzde de görünür (0.4.13 dersi).

## Adım 3 — prompt önbelleği

İki şey öneki bozuyordu:

1. **Eski tur kırpma önbelleği öldürüyordu.** Geçmişin ortasındaki bir iletiyi
   değiştirmek, o noktadan sonrasını önbellekten düşürür. Artık kırpma yalnızca
   bağlam **80 000 karakteri** geçtiğinde yapılır (`shouldTrimStale`).
2. **Sağlayıcı farkı.** OpenAI/DeepSeek öneki otomatik önbelleğe alır — yeter ki
   bayt bayt aynı kalsın. Anthropic `cache_control` bloğu ister: sistem iletisi
   ve son araç tanımı işaretlenir (`withAnthropicCache`). Varsayılan kapalı;
   `EVREN_PROMPT_CACHE=anthropic` veya anthropic.com uç noktasıyla açılır —
   bilinmeyen ağ geçitlerinde isteği bozmamak için.
3. **Sistem istemi parmak izi.** Koşu ortasında değişirse günlüğe uyarı yazılır
   (`promptFingerprint`), çünkü önbellek sıfırlanır.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `prefetch-cache-test` | 40 | Aday çıkarma, kapsam koruması, ön okuma bütçeleri, önbellek işaretleri, parmak izi |
| `subagent-parallel-e2e-test` | 8 | Alt ajan içi paralel araç + ön okuma + görünürlük |
| `tools-parallel-e2e-test` | 10 | Ana ajanda paralel/seri ayrımı |
| `performance-plan-test` | 52 | Donanım profilleri, kırpma |

Toplam: **73 paket / 1791 kontrol** (önceki 71/1743). typecheck ✓ build ✓ e2e ✓

## Beklenti ve ölçüm notu

Bu üç değişiklik **ölçülebilir** olmalı: ön okuma ajan başına 2-5 adım,
paralel araç ajan başına saniyeler, önbellek giriş gecikmesini düşürmeli.
Ancak 0.4.20 dersini tekrarlamamak için: **tek koşu kanıt değildir**, modelin
kaç ajan açtığı ve her adımda ne ürettiği toplam sürede baskın. Doğru ölçüm
en az 2-3 koşunun ortalamasıdır ve `prefetchedFiles` alanı her ajan için
günlükte görünür.

## Bilinen sınırlar

- Ön okuma isteme bağlı: model dosya adı yazmazsa aday bulunamaz (o zaman
  normal akış).
- Ön okuma toplam 60 kB ile sınırlı; çok büyük dosyalarda kırpılır.
- Anthropic önbellek işaretleri varsayılan kapalı.
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
