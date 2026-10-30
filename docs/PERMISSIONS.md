# Kural tabanlı izinler

Araç izinleri iki katmanlıdır:

1. **Kategori varsayılanı** — `read`, `edit`, `execute`, `browser`, `mcp`, `computer`
   için `allow` / `ask` / `deny`.
2. **Kaynak kuralları** — belirli bir komut, yol veya adres için kategori varsayılanını ezer.

Kurallar **Ajan → İzinler (gelişmiş) → Kural tabanlı izinler** bölümünden düzenlenir ve
`settings.json` içindeki `permissions.rules` alanında saklanır.

## Kural biçimi

```json
{
  "id": "rule_lz3k1",
  "category": "execute",
  "resource": "git push*",
  "effect": "ask",
  "note": "Force push her zaman sorulsun"
}
```

| Alan | Anlam |
|---|---|
| `category` | Hangi izin kategorisine uygulanacağı |
| `resource` | Komut, yol, URL veya araç adı deseni |
| `effect` | `allow`, `ask`, `deny` |

## Kaynak (resource) çıkarımı

| Araç | Kaynak |
|---|---|
| `run_command` | Komut metni |
| `run_python`, `execute` | Kodun ilk satırı |
| `git` | `git <action>` (örn. `git push`) |
| `read_file`, `write_file`, `edit_file`, `delete_file`, `create_directory`, `list_files`, `reference` | `path` |
| `glob`, `grep`, `code_search` | Desen/sorgu |
| `webfetch`, `browser_open` | URL |
| `websearch` | Sorgu |
| `browser_*` | URL veya seçici |
| `mcp_*`, `plugin_*`, `computer_*` | Araç adı |
| Diğer araçlar | Boş — kural uygulanmaz |

Kaynağı boş olan araçlarda yalnızca kategori varsayılanı geçerlidir.

## Desen sözdizimi

- `*` — her şey (satır sonu dahil), örn. `git push*`
- `?` — tek karakter, örn. `npm run ?`
- Diğer karakterler birebir eşleşir; `.` gibi regex karakterleri kaçırılır
- Büyük/küçük harf duyarsız

## Çözümleme sırası

1. **Plan modu**: `edit`, `execute`, `computer` her zaman `deny`. Kurallar bunu **ezemez**.
2. **En özel kural**: eşleşen kurallar arasında en çok sabit karakter içeren desen kazanır.
   Eşitlikte son tanımlanan kural geçerlidir.
3. **Kategori varsayılanı**: `permissions[category]`.
4. **Mod varsayılanı**: `confirm` → `ask`, `auto` → `allow`.

## Örnekler

```json
{
  "execute": "allow",
  "rules": [
    { "category": "execute", "resource": "git push*", "effect": "ask" },
    { "category": "execute", "resource": "rm -rf*", "effect": "deny" },
    { "category": "edit", "resource": "src/**", "effect": "allow" },
    { "category": "edit", "resource": "package.json", "effect": "ask" },
    { "category": "read", "resource": "https://example.com/*", "effect": "allow" }
  ]
}
```

Bu örnekte komutlar genelde izinlidir; `git push` sorar, `rm -rf` engellenir. `src/` altındaki
düzenlemeler izinlidir, `package.json` değişikliği sorar.

## Sınırlar

- Kural sayısı en fazla **200**; desen en fazla 300, kimlik 64 karakter.
- Alt ajanlar aynı kural setini kullanır; onay isteği ana oturumun kimliğiyle gösterilir.
- Onay diyalogundan “her zaman izin ver” henüz yok; kural eklemek için Ajan panelini kullanın.
- `patch` ve `spawn_agent` gibi çok dosyalı araçlarda kaynak çıkarılmaz; kategori varsayılanı
  geçerlidir.

## Testler

```bash
node scripts/run-unit.cjs scripts/permission-test.ts
```

31 senaryo: desen eşleştirme, özgüllük sırası, kategori ayrımı, plan modu koruması,
kaynak çıkarımı.
