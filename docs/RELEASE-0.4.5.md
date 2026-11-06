# 0.4.5 Beta — arayüz yenilemesi

Beş kozmetik/UX iyileştirmesi. Mantık değişmedi; yalnızca yerleşim ve
etkileşim.

## 1. Sürüklenebilir ve gizlenebilir paneller

Sohbet listesi, inceleme, dosyalar, görevler, git ve terminal artık
**tutamaktan sürüklenerek boyutlandırılıyor** ve gizlenebiliyor.

| Panel | Varsayılan | Aralık |
|---|---|---|
| Sohbet listesi | 290 px | 180–520 |
| İnceleme | 440 px | 280–900 |
| Dosyalar | 480 px | 280–900 |
| Görevler | 360 px | 240–720 |
| Git | 480 px | 280–900 |
| Terminal (yükseklik) | 260 px | 140–640 |

- **Çift tık** varsayılana döndürür; **Home** tuşu da aynısını yapar.
- **Ok tuşları** ±16 px, **Shift+Ok** ±64 px.
- Boyut ve gizleme durumu `localStorage`'da saklanır; uygulama yeniden
  açılınca hatırlanır.
- Sohbet listesi `‹` düğmesiyle gizlenir; gizliyken araç çubuğunda `›`
  düğmesi görünür.
- **Sohbet kolonuna her zaman en az 420 px** kalır. Bu sınır olmadan iki
  panel birlikte genişleyince düğmeler komşu panelin altına giriyor ve
  tıklanamıyordu (canlı testte yakalandı).

Tasarım referansı: VS Code/Zed panel ayırıcıları — görünmez 7 px tutamak,
üzerine gelince vurgu, çift tıkla sıfırla.

## 2. Otomatik mod şeridi kaldırıldı, "Oto" düğmesi kırmızı

Eski hâlde ekranın enini kaplayan kırmızı bir şerit vardı. Kaldırıldı;
otomatik mod artık **düğmenin kendisinde** görünüyor:

- Kırmızı zemin, kırmızı kenarlık, yanıp sönen nokta.
- `Onaylı` modda nötr gri kalır.
- Plan modu şeridi de inceltildi (tam genişlik blok yerine ince bilgi satırı).

Bu, durumu göstermek için ayrı bir satır harcamaz — başlık alanında zaten
bir düğme vardı.

## 3. Sohbet alanı daha ölçülü

Sohbet kolonu **en fazla 920 px** genişliğinde ve ortalanır. Geniş ekranda
satırlar 1500 px'e yayılıp okunaksız olmuyor (ChatGPT/Claude ile aynı
aralık: ~95 karakter).

Önemli ayrıntı: sınır yalnızca **sohbet içeriğine** uygulanır, `.chat`
kabına değil — yan paneller o kabın içinde render edildiği için kabı
sınırlamak panel genişliklerini ve tutamak konumlarını bozuyordu.

## 4. Besteci: tek satırdan büyür, 5 satırda durur

- Başlangıç **tek satır** (22 px).
- Yazdıkça büyür; **5 satırda (108 px)** durur ve kaydırma başlar.
- Böylece uzun mesaj yazarken sohbet geçmişi yukarıdan itilmiyor.

Tasarım referansı: shadcn/ui `PromptInput` ve modern sohbet arayüzlerinin
otomatik büyüyen metin alanı.

## 5. Gönder düğmesi kutunun içinde

Tek bir çerçeve: metin alanı üstte, düğmeler altta, gönder sağ altta
**hap biçiminde** (``Gönder ↑``). Kenarlık yalnızca dış kutuda; odaklanınca
tek bir vurgu halkası.

- Dar pencerede etiket gizlenir, yalnızca `↑` ikonu kalır.
- `Build`, `@ Dosya`, `📎 Ekle`, `🎙 Ses` düğmeleri kutunun alt satırında,
  küçültülmüş ve gerektiğinde yatay kaydırılıyor.

## Doğrulama

- **49 test paketi / 1071 kontrol** (önceki: 48/1032)
- Yeni: `panel-layout-test` — 39 kontrol (sınırlar, sürükleme yönü,
  klavye, pencere payı, spec tutarlılığı)
- `ui-resize-test.cjs` — gerçek Electron penceresinde 13 kontrol:
  sürükleme, alt sınır, kalıcılık (yeniden açılış), gizleme kalıcılığı,
  yan panel, terminal tutamağı, klavye, sohbet payı
- typecheck ✓ · build ✓ · e2e ✓
- Koyu ve açık tema ekran görüntüleriyle doğrulandı

## Test sırasında bulunan ve düzeltilen gerçek kusurlar

1. **Panel sürüklemesi tepkisizdi.** React sentetik olayları + pointer
   capture kombinasyonu hızlı hareketlerde olay kaybediyordu. `document`
   üzerinde global `pointermove`/`pointerup` dinleyicilerine geçildi.
2. **Tutamaç klavye odağı almıyordu.** `pointerdown` içindeki
   `preventDefault` odağı engelliyordu; kaldırıldı.
3. **Sınır iki kez uygulanıyordu** (%85 çarpanı + sohbet payı), panel
   maksimumda kilitlenip sürüklemeye tepki vermiyordu.
4. **Araç çubuğu dar kolonda taşıyordu** — düğmeler komşu panelin altında
   kalıp tıklanamıyordu. `flex-wrap` eklendi.

## Bilinen sınırlar
- Panel genişlikleri piksel cinsinden saklanır; farklı DPI/ölçekte yeniden
  sınırlanır (taşma olmaz, yalnızca varsayılana yaklaşabilir).
- Yan paneller birbirini kapatır (tek panel açık), bu davranış korundu.
- Windows yayıncı imzası yok; SmartScreen uyarısı gösterebilir.
