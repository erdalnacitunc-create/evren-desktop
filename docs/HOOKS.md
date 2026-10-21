# Hook’lar

EVREN Desktop iki isteğe bağlı hook sunar. Varsayılan olarak kapalıdır.

## Düzenleme sonrası format

- **Ajan > Kancalar > Düzenleme sonrası Prettier ile formatla**.
- `write_file` / `edit_file` sonrasında dosya, projedeki
  `node_modules/prettier` ile formatlanır.
- Prettier yüklü değilse hook sessizce atlanır; araç sonucunda not görünür.
- Alt-ajanların `general` yazma işlemlerinde de uygulanır.
- Formatlama diff’ten sonra çalışır; araç kartındaki diff, format öncesi hali
  gösterebilir.

## Commit öncesi kontroller

- **Ajan > Kancalar > Commit öncesi kontrolleri çalıştır**.
- Git panelinde **Commit** tıklandığında `package.json` içindeki
  `typecheck / lint / test / build` scriptleri çalıştırılır.
- Herhangi biri başarısızsa commit **yapılmaz** ve hata gösterilir.
- Kontrol script’i yoksa commit normal şekilde devam eder.
- Kontroller `workspace.runChecks` ile aynı altyapıyı kullanır.

## Notlar

- Format hook’u yalnızca Prettier’i destekler (şimdilik).
- Kontroller proje bazlıdır; uzun sürebilir.
- Hook ayarları `settings.json` içindeki `hooks` alanında saklanır.
