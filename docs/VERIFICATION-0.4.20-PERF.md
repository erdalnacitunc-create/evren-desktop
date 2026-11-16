# Doğrulama kaydı — 0.4.20 performans optimizasyonu

Bu belge bir sürüm notu değil, **ölçüm ve dürüst değerlendirme** kaydıdır.
Optimizasyon kod olarak doğru çalışıyor; ancak **beklenen hız kazancını
vermedi**. Nedeni de ölçüldü.

## Yapılan optimizasyon

| Bileşen | Ne yapar |
|---|---|
| `hardwareProfile.ts` | Çekirdek/RAM ölçer → araç paralelliği (1/2/3), alt ajan eşzamanlılığı (1/2), araç çıktısı tavanı (6/10/12 kB) |
| `toolRunner.ts` | Sınırlı eşzamanlılık; yalnızca salt-okunur araçlar paralel, yazma varsa hepsi seri |
| `toolOutput.ts` | Girişte kırpma (baş+son korunur) + eski turlarda agresif kırpma; `task_wait` raporları asla kırpılmaz |

Gerekçe: OpenAI `ToolOutputTrimmer` (eski büyük çıktılar token yer, önemini
yitirir) ve Anthropic'in "alt ajanlar 3+ aracı paralel çağırsın" ölçümü.
Düşük donanım kısıtı: her `run_command` bir PowerShell süreci açar; 4 GB'lik
makinede sınırsız paralellik diski döver → paralellik ölçülür, sabit değil.

## Kod doğrulaması

| Test | Sonuç |
|---|---|
| `performance-plan-test` | 52/52 — profil tabloları, paralel kararı, kırpma, eşzamanlılık sınırı |
| `tools-parallel-e2e-test` | 10/10 — log: `paralel araç: 3 çağrı · 3 eşzamanlı`; yazma içeren adımda paralel yol kullanılmadı |
| Tam paket | 71/71 · 1743/1743 |
| Üç fazlı canlı | 24/24 geçti, 0 kısmi, 0 yanlış yönlendirme |

## Ama hız kazancı yok — ölçüm

| | 0.4.19 | 0.4.20 |
|---|---|---|
| Toplam süre | 2447 sn | **2924 sn** (+19%) |
| Ana ajan adımı | 38 | 33 |
| Adım başına ortalama | 62,6 sn | **88,4 sn** |
| En uzun adım | 318 sn | 357 sn |
| Alt ajan | 6 | 9 |
| **Paralel tetiklenme** | 0 | **3** |

Paralel yol üç kez tetiklendi ve **hepsi 2 çağrılık** paketlerdi (16, 2, 4 ms).
Yani kazanç ölçülemeyecek kadar küçük.

## Neden kazanç yok — kök neden

1. **Model adım başına genellikle tek araç çağırıyor.** 68 araç çağrısı ~33
   adımda yapıldı; paralel fırsat (aynı adımda 2+ okuma) yalnızca 3 kez doğdu.
   Paralellik ancak model toplu okuma isterse işe yarar.
2. **Süre araçlarda değil, üretimde.** Araç payı hâlâ <%2; bir adım ortalama
   62-88 sn sürüyor ve bunun neredeyse tamamı modelin metin üretmesi.
3. **Alt ajanların içinde paralellik yok.** `subagent.ts`'e yalnızca kırpma
   eklendi; alt ajan araçları hâlâ sırayla çalıştırıyor. Sürenin büyük kısmı
   orada geçiyor (6-9 ajan × 40-540 sn).
4. **Tek koşu varyansı yüksek.** Aynı istemle toplam süre 2447↔2924 sn arasında
   oynuyor; modelin kaç alt ajan açtığı ve her adımda ne kadar ürettiği
   belirleyici. Bu yüzden tek koşuyla "hızlandı/yavaşladı" demek yanıltıcı.

## Gerçek darboğaz ve doğru sonraki adım

Ölçüm sıralaması:

| Etken | Pay |
|---|---|
| Model üretim süresi (adım başına 60-90 sn) | **~%95** |
| Araç yürütme | ~%2 |
| Alt ajan sıralı araç çağrıları | büyük ajanlarda belirgin |

Bu yüzden sonraki optimizasyon **paralel araç değil** şunlar olmalı:

1. **Alt ajan içinde paralel araç** (aynı `toolRunner` mantığı — asıl kazanç
   burada, çünkü 500 sn'lik ajanların 20 adımı var).
2. **Adım sayısını azaltmak** — modelin tek adımda daha çok iş yapması
   (toplu okuma istemde zaten var; ölçüldü, model uymuyor).
3. **Prompt önbelleği** — araç tanımları ve sistem istemi sabit tutularak
   sağlayıcı önbelleğinden yararlanmak (gecikmeyi doğrudan düşürür).

## Karar

Optimizasyon **korundu**: kod doğru, test edilmiş, düşük donanımda güvenli ve
büyük araç çıktısında bağlamı koruyor. Ama "hız optimizasyonu" olarak
sunulmamalı — bu sürüm **bağlam/kararlılık** iyileştirmesidir. Hız için
yukarıdaki 3 madde gerekli.
