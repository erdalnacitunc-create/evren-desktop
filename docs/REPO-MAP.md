# Repo Map (Kod Haritası)

Repo map, çalışma alanındaki kaynak dosyalardan **dosya + sembol** haritası çıkarır.
Amaç, ajanın bilinmeyen bir projede önce yapıyı görmesi ve ardından yalnızca
ilgili dosyaları okumasıdır.

## Kullanım

### Panel
**Dosyalar > Harita** sekmesinde:
- Dosya sayısı ve sembol sayısı.
- Dosya yolu + satır numaralı semboller (fonksiyon, sınıf, tip, export).
- **Yenile** ile haritayı yeniden üretme.

### Ajan aracı
`repo_map` aracı:

```json
{ "query": "runAgent", "max_files": 300 }
```

- `query`: dosya yolu veya sembol adı filtresi.
- `max_files`: en fazla dosya (varsayılan 300, üst sınır 600).

Ajan, haritayı aldıktan sonra `read_file`, `grep` veya `glob` ile ilgili dosyalara
geçmelidir.

## Desteklenen diller

TypeScript/JavaScript, Python, Go, Rust, Java, C#, C/C++, Ruby, PHP, Swift, Kotlin.
Sembol çıkarımı hafif regex tabanlıdır; tam bir AST/LSP değildir.

## Sınırlar

- `node_modules`, `.git`, `dist`, `out`, `build`, `target`, `vendor` gibi dizinler
  atlanır.
- Dosya başına 512 KB, 100 sembol; toplam çıktı 60 KB ile sınırlıdır.
- Yalnızca kaynak dosya uzantıları taranır.
- Harita tam bağlam yerine bir **iskelet**tir; ajan gerekli dosyaları ayrıca okumalıdır.
- Henüz anlamsal/embedding tabanlı kod indeksi yok; sembol haritası statiktir.
