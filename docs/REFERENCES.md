# External references

Agent, workspace dışındaki bazı klasörleri **read-only** referans olarak
okuyabilir. Bu özellik varsayılan olarak kapalıdır; açıkça tanımlanmış
klasörler dışına erişilemez.

## Yapılandırma

`settings.json` içine `references` ekle:

```json
{
  "references": [
    {
      "name": "docs",
      "path": "C:\\Users\\erdal\\Documents\\projeler\\docs"
    },
    {
      "name": "android",
      "path": "C:\\Users\\erdal\\AndroidStudioProjects"
    }
  ]
}
```

Kurallar:

- `name` yalnızca harf, rakam, `_`, `.` ve `-` içerebilir.
- `path` var olan bir klasör olmalı.
- Yalnızca **okuma** yapılır; yazma/silme/komut çalıştırma yoktur.
- Symlink ile referans dışına çıkma engellenir.
- Her referans için toplam okuma boyutu 512 KB ile sınırlıdır.

## Agent kullanımı

```text
reference action=list
reference action=list path="docs:"
reference action=read path="docs:README.md"
reference action=read path="android:app/build.gradle.kts" offset=1 limit=200
```

## Güvenlik

- Referanslar `settings.json` içinde tutulur; API anahtarı/token yazma.
- Agent yalnızca tanımlı köklerin altındaki dosyaları okuyabilir.
- Mutlak yol verilse bile yolun tanımlı bir referansın içinde olduğu doğrulanır.
- Bu özellik workspace araçlarının yerini almaz; workspace yazma/komut yetkisi
  ayrı ve onay akışına tabidir.
