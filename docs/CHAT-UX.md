# Sohbet UX — OpenCode karşılaştırması ve düzeltmeler

## Karşılaştırılan temel sohbet davranışları

| Davranış | OpenCode | EVREN Desktop (önce) | EVREN Desktop (şimdi) |
|---|---|---|---|
| Çok satırlı composer | ✅ | ✅ | ✅ |
| Enter gönder / Shift+Enter satır | ✅ | ✅ | ✅ |
| Yanıt üretirken durdurma | ✅ | ✅ | ✅ |
| Yanıt sürerken yazma | ✅ | ❌ textarea disabled | ✅ yazılabilir |
| Kullanıcı yukarı kaydırınca auto-scroll durur | ✅ | ❌ 100px eşik / hemen aşağı | ✅ 24px + wheel niyeti |
| “En alta in” düğmesi | ✅ | ❌ | ✅ |
| Mesaj kopyalama | ✅ | ❌ | ✅ hover aksiyonu |
| Kod bloğu kopyalama | ✅ | ❌ | ✅ kod bloğu köşesi |
| Yanıtı yeniden üretme | ✅ | sadece hata sonrası | ✅ son yanıtta |
| Dosya/görsel eki | ✅ | ❌ | ✅ 📎 / sürükle-bırak / pano |
| `@dosya` bağlamı | ✅ | ❌ | ✅ |
| Composer otomatik büyüme | ✅ | ❌ sabit 3 satır | ✅ 74–180px |
| Plan / Build | ✅ | ❌ | ✅ Shift+Tab |
| Todo / görevler | ✅ | sadece “çalışıyor” | ✅ kalıcı panel |
| İzin onayı | ✅ | tek mod | ✅ kategori + her zaman izin |
| Checkpoint / geri al | ✅ | son değişiklik | ✅ adım bazlı |
| Uzun panel scroll | ✅ | ❌ taşıyordu | ✅ max-height + wheel |

## Yapılan düzeltmeler

1. **`.params-panel`**: `max-height: min(72vh, 640px)`, `overflow-y: auto`,
   `overscroll-behavior: contain`. Ajan/izin/parametre panelleri artık fareyle
   kaydırılıyor ve ekran dışına taşmıyor.
2. **Auto-scroll**: eşik 100px → 24px; `onWheel` yukarı hareketinde takibi kapatır.
   Kullanıcı yukarı kaydırdıysa gelen token’lar artık aşağı zıplatmaz.
3. **“En alta in”**: kullanıcı yukarıdayken sağ altta `↓` düğmesi; tıklanınca
   takip yeniden açılır.
4. **Streaming sırasında yazma**: textarea disabled kaldırıldı; yanıt sürerken
   sonraki mesaj yazılabilir. Gönderim yanıt bitince yapılır.
5. **Composer auto-resize**: 74–180px arasında büyür; uzun istemler görünür.
6. **Mesaj/kod kopyalama**: mesaj altında `⧉ Kopyala`, kod bloğunda `⧉`.
7. **Yeniden üret**: son asistan yanıtında `↻ Yeniden üret`.
8. **W3 checks**: `Dosyalar > Kontroller` + `run_checks` aracı; typecheck/lint/test/
   build scriptleri algılanır ve çalıştırılır.

## İstem geçmişi (geri / ileri)

Gönderilen istemler besteci içinde hatırlanır:

- `Alt+↑` — önceki istemi geri getirir (geri)
- `Alt+↓` — sonraki isteme, yığın sonunda yazmakta olduğunuz taslağa döner (ileri)
- Bestecinin solundaki `↶` / `↷` düğmeleri aynı işi yapar

Detaylar:

- Son 100 istem tutulur; art arda aynı istem tekrarı yığına eklenmez.
- Oturum açıldığında geçmiş, o oturumdaki kullanıcı mesajlarından tohumlanır; uygulamayı
  yeniden başlatmak geçmişi silmez.
- Gezinmeye başlamadan önce yazdığınız metin taslak olarak saklanır ve ileri gezinmenin
  sonunda geri gelir.
- İstem gönderildiğinde gezinme sıfırlanır.
- Geçmiş yalnızca bellekte tutulur; ayrı bir dosyaya yazılmaz.

Kod: `src/renderer/src/lib/promptHistory.ts` (saf fonksiyonlar), testler:
`node scripts/run-unit.cjs scripts/prompt-history-test.ts`.
