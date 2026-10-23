# Code Mode

Agent `execute` aracı, birden fazla aracı tek bir JavaScript script’i içinde
çağırmayı sağlar.

## Kullanım

```js
const readme = await tools.read_file({ path: "README.md" });
const test = await tools.run_command({ command: "npm test", timeout_ms: 120000 });
return { readme: readme.content.slice(0, 500), test: test.content };
```

## Erişilebilir araçlar

Script içinde normal agent araçlarının çoğu `tools.<araç_adı>({...})` biçiminde
çağrılabilir:

- `read_file`, `write_file`, `edit_file`, `patch`, `delete_file`
- `glob`, `grep`, `list_files`, `repo_map`, `code_search`
- `run_command`, `run_checks`, `git`
- `webfetch`, `websearch`
- browser araçları
- MCP/plugin araçları

`execute` ve `question` kendini çağıramaz; alt-ajan/task araçları da Code Mode
içinde kapalıdır.

## Onay ve güvenlik

- `execute` aracı **execute** izin kategorisindedir.
- Confirm modunda script çalıştırılmadan önce onay istenir.
- Auto modda, diğer execute araçlarında olduğu gibi otomatik onay uygulanır.
- Script 30 saniye ile sınırlıdır.
- Sandbox `vm` tabanlıdır; host `require`, `process` veya doğrudan dosya sistemi
  erişimi vermez. Ancak içinden çağrılan araçlar agent’ın normal yetkilerini
  kullanır.
- Hassas işlemlerde confirm modunu kullanın.
