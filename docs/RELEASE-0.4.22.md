# 0.4.22 Beta — üst çubukta güncelleme düğmesi

Güncelleme akışı yalnızca Ayarlar > Genel içindeydi; kullanıcı yeni sürümü
görmek için üç tık uzağa bakmak zorundaydı. Üst çubukta **her zaman görünür**
bir düğme eklendi.

## Davranış

| Faz | Görünüm | Tıklama |
|---|---|---|
| `idle` / `not-available` | soluk ikon + "Güncellemeleri denetle" | denetle |
| `checking` | dönen ikon | — |
| `available` | mavi rozet + "v0.4.22 hazır — indir" + nabız noktası | indir |
| `downloading` | dönen ikon + "İndiriliyor %42" | — |
| `downloaded` | yeşil "Kur ve yeniden başlat" | kur + yeniden başlat |
| `error` | kırmızı "Güncelleme hatası — yeniden dene" | yeniden dene |
| `disabled` | **gizli** (paketlenmemiş yapı) | — |

Düğme tek tıkla akışı ilerletir — kullanıcı Ayarlar'a yönlendirilmez. Sürüm
notları ve ayrıntılar Ayarlar panelinde kalır (orada değişiklik yok).

Referans: opencode ve Antigravity, yeni sürümü her zaman görünür bir rozetle
bildirir; indikten sonra aynı düğme "yeniden başlat"a döner.

## Uygulama

- `components/UpdateButton.tsx` — düğme; durum aboneliği `api.updater.onStatus`.
- `lib/updateButton.ts` — **saf** durum türetimi (`updateButtonState`,
  `downloadPercent`, `UPDATE_PHASE_KEYS`). Test edilebilir; buton tahmin etmez.
- `assets/update-button.css` — koyu/açık tema, `prefers-reduced-motion`,
  1180 px altında yalnızca ikon (dar pencerede üst çubuk taşmasın).
- 14 yeni i18n anahtarı (tr/en): `update.topbar*`.

Erişilebilirlik: `aria-label` + `title` her fazda metin taşır, `disabled`
durumu gerçek `disabled` özniteliğiyle verilir, rozet animasyonu
`prefers-reduced-motion` ile kapanır.

## Doğrulama

`update-button-test` (30 kontrol): her faz → niyet/ton/görünürlük/rozet,
`canCheck` kapalıyken, `busy` iken, yüzde sıkıştırma, faz anahtar bütünlüğü.

Toplam: **74 paket / 1821 kontrol** (önceki 73/1791). typecheck ✓ build ✓ e2e ✓

Görsel önizleme: `docs/update-button-preview.html` (tüm durumlar yan yana).

## Bilinen sınırlar

- Düğme yalnızca paketlenmiş yapıda görünür; `npm run dev` sırasında gizli
  (güncelleme denetimi orada çalışmaz).
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
