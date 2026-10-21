# Alt-Ajanlar (spawn_agent)

EVREN Desktop, karmaşık işleri ayrı bağlamda çalışan alt-ajanlara devredebilir.
Ana ajan yalnızca alt-ajanın **özet sonucunu** görür; böylece uzun dosya/araç
çıktıları ana konuşma bağlamını şişirmez.

## Türler

| Tür | Yetki | Kullanım |
|---|---|---|
| `explore` | Salt-okunur | Kod tabanı keşfi, dosya/anahtar kelime bulma |
| `review` | Salt-okunur | Kod incelemesi, risk/hata/performans analizi |
| `general` | Çalışma alanı araçları | Bağımsız çok adımlı görev; dosya oluşturma/düzenleme |

- `explore` ve `review`; `read_file`, `list_files`, `glob`, `grep`, `todo_write`
  gibi salt-okunur araçlarla çalışır.
- `general`; `write_file`, `edit_file`, `run_command`, `run_checks`, `git` dahil
  çalışma alanı araçlarını kullanabilir.
- Plan modunda `general` de salt-okunur çalışır.
- Alt-ajanlar kendi alt-ajanlarını başlatamaz (özyineleme yok).

## Akış

1. Ana ajan `spawn_agent` aracını çağırır:
   ```json
   { "agent": "explore", "prompt": "README.md ve app.ts dosyalarını incele; anahtar kelimeyi bul." }
   ```
2. Alt-ajan ayrı bir mesaj/araç bağlamında çalışır.
3. Ana ajana yalnızca kısa sonuç döner (en fazla ~12K karakter).
4. UI’da araç kartı **Alt ajan · explore/general/review** olarak görünür.

## İzinler

- `spawn_agent` kategorisi `read`’dir; Onaylı modda başlatma onayı istenebilir.
- `general` alt-ajanının yazma/komut araçları, ana oturumun izin politikasına ve
  moduna tabidir; onay gerekiyorsa aynı onay kartı gösterilir.
- Plan modunda yazma/komut/bilgisayar izinleri kapalıdır.

## Depolama / sınırlar

- Alt-ajanlar `background=true` ile **arka planda/paralel** çalışabilir. Görev
  kimliği hemen döner; sonuç `task_wait` veya `task_status` ile alınır.
- `task_list` oturumdaki görevleri, `task_cancel` çalışan görevi iptal eder.
- Görevler `%APPDATA%\evren-desktop\subagent-tasks.json` içinde saklanır.
- Uygulama yeniden başlatıldığında çalışmakta olan görevler
  **`interrupted`** olarak işaretlenir; sonuçları kaybolur.
- Görev geçmişi son 100 kayıtla sınırlıdır.
- Otomatik devam/retry henüz yok; kesilen görev kullanıcı tarafından yeniden
  başlatılmalıdır.
- Alt-ajanlar yalnızca çalışma alanı araçlarını kullanır; MCP, eklenti, tarayıcı ve
  bilgisayar kontrolü ana ajanda kalır.
- Alt-ajan çıktısı özetlenir; tam araç günlüğü ana sohbete taşınmaz.

## Yeniden deneme / otomatik sürdürme

- Uygulama kapanırken çalışan arka plan görevleri interrupted olarak işaretlenir.
- Görev panelinde kesilen, iptal edilen veya hata alan görevler için **Yeniden dene**
  düğmesi bulunur; deneme sayısı gösterilir.
- **Ayarlar > Alt-ajanlar > Açılışta otomatik sürdür** açıksa kesilen görevler
  açılışta en fazla 2 kez otomatik yeniden denenir.
- Otomatik sürdürmede onay gerektiren araç çağrıları otomatik kabul edilir; açık
  engelle politikası hâlâ geçerlidir.
- Görevlerin modeli ve çalışma alanı kayıtla birlikte saklanır.
