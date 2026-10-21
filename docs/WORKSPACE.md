# Çalışma Alanı (Dosya Araçları)

EVREN Desktop, OpenCode benzeri bir **proje çalışma alanı** sunar. Model, seçilen
klasör içinde gerçek dosyalar üzerinde çalışabilir. Amaç, sohbetten kopyalanan kod
blokları yerine doğrudan diskte dosya oluşturmak/düzenlemek ve değişiklikleri
inceleyip geri alabilmektir.

## Kurulum

1. Üst çubukta **Klasör Seç** düğmesine basın (veya **Ajan > Dosya araçları >
   Klasör Seç**).
2. Bir proje klasörü seçin. Yol `settings.json` içinde saklanır.
3. Ajan açık ve seçili model araç çağırmayı destekliyorsa dosya araçları otomatik
   olarak kullanılabilir.
4. Sağdaki **Dosyalar** düğmesi çalışma alanı panelini açar.

## Model araçları

| Araç | Açıklama |
|---|---|
| `read_file` | Satır numaralı metin okur (`offset`, `limit`). |
| `write_file` | Dosya oluşturur veya tamamen yeniden yazar. |
| `edit_file` | Birebir eşleşen metni değiştirir (`replace_all` destekli). |
| `delete_file` | Dosyayı siler (yedeklenir). |
| `create_directory` | Klasör oluşturur. |
| `list_files` | Dosya ağacını listeler. |
| `glob` | `**/*.ts` gibi desenlerle dosya arar. |
| `grep` | Dosyalarda düzenli ifade arar (`dosya:satır: metin`). |
| `run_command` | Çalışma alanında PowerShell / sh komutu çalıştırır. |

Model yolları **çalışma alanına göreli** verir. Örneğin `src/app.ts`.

## Arayüz

- **Dosyalar sekmesi:** dosya ağacı; bir dosyaya tıklayınca içerik önizlemesi.
- **Değişiklikler sekmesi:** son değişiklikler (yazıldı / düzenlendi / silindi /
  klasör), zaman damgası ve unified diff.
- **Geri Al:** son dosya değişikliği **adımını** yedekten geri yükler. Her araç
  çağrısı ayrı bir checkpoint’tir; sohbet kartındaki **Bu adımı geri al** ile de
  aynı işlem yapılabilir.
- **Aç:** çalışma alanını Windows Explorer'da açar.
- **Yenile:** ağacı ve değişiklikleri yeniden yükler. Araç sonuçlarından sonra
  panel otomatik yenilenir.

## Güvenlik

- Tüm dosya işlemleri seçilen klasörle sınırlıdır; `..` veya symlink ile dışarı
  çıkma engellenir.
- `.git` dizinine yazma/okuma engellenir.
- İkili ve 4 MB'tan büyük dosyalar yazılamaz; okuma 512 KB'ta kısaltılır.
- Her yazma/düzenleme/silme öncesi **yedek** alınır. Yedekler
  `%APPDATA%\evren-desktop\workspace-backups` altında tutulur (en fazla 120 kayıt).
- **Onaylı** modda her araç çağrısı için onay istenir. **Otomatik** modda işlemler
  onaysız uygulanır; bu moddayken `run_command` dahil tüm araçlara dikkat edin.
- `run_command` kabuk erişimi verir. Çalışma alanı dışına `cd` gibi komutlarla
  çıkmak teknik olarak mümkündür; güvenilmeyen görevlerde Onaylı modu kullanın.

## Sınırlamalar / sonraki adımlar

- Git'e özel UI (branch/status) henüz yok; `run_command` ile `git` kullanılabilir.
- Birden fazla değişikliği tek işlemde geri alma (çok adımlı undo/redo) yok;
  şimdilik son değişiklik geri alınır.
- `apply_patch` (çok dosyalı yama) yerine `edit_file` kullanılır.
- Dosya izleme (watcher) yok; panel araç sonuçlarında ve Yenile'de güncellenir.
