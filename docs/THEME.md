# Tema ve Erişilebilirlik

## Tema

Üç mod:

- **Koyu** (varsayılan)
- **Açık**
- **Sistem** — Windows açık/koyu tema tercihini izler.

Değiştirme:

1. Üst çubuktaki **☾ / ☀ / ◐** düğmesi (koyu → açık → sistem).
2. **Ayarlar > Görünüm**.
3. **Ctrl+K** komut paletinde **Temayı değiştir**.

Seçim `settings.json` içinde `theme` alanında saklanır. Sistem modunda tema
değişikliği anında uygulanır.

## Erişilebilirlik

- Tüm etkileşimli öğelerde `:focus-visible` mavi odak halkası.
- `prefers-reduced-motion` açıksa animasyon/geçişler neredeyse kapatılır.
- Komut paleti ve ayarlar modalı `role="dialog"` + `aria-modal`.
- Sohbet alanı `role="log"` ve `aria-label` ile işaretlenir.
- Tema düğmesi ve pencere kontrolleri `aria-label` taşır.
- Yüksek kontrastlı açık tema yüzeyleri (panel, kod, diff, formlar) ayrı tanımlıdır.
