# EVREN Desktop Eklenti Formatı (E3)

Eklentiler, EVREN Desktop'a yeni **araçlar** kazandıran küçük JavaScript
modülleridir. İzole bir utility process içinde, kısıtlı bir `vm` bağlamında
çalışırlar.

## Manifest
Repo kökünde `evren.extension.json`:

```json
{
  "name": "Hello Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "permissions": {
    "network": ["api.example.com"],
    "filesystem": false,
    "shell": false
  }
}
```

Alternatif olarak `package.json` içinde:

```json
{
  "name": "hello-plugin",
  "evren": {
    "entry": "index.js",
    "permissions": { "network": [] }
  }
}
```

## Giriş dosyası
CommonJS (CJS) olmalıdır:

```js
module.exports = {
  register(api) {
    api.registerTool({
      name: 'word_count',
      description: 'Metindeki kelime sayısını döndürür',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      async execute({ text }) {
        const count = String(text).trim().split(/\s+/).filter(Boolean).length
        return `${count} kelime`
      }
    })
  }
}
```

## API
| Üye | Açıklama |
|---|---|
| `api.registerTool({ name, description, inputSchema, execute })` | Araç kaydeder. |
| `api.log(...)` | Ana sürece günlük gönderir. |
| `api.fetch(url, init)` | Yalnızca `permissions.network` listesindeki host'lara istek. |
| `api.storage.get(key)` | Eklentiye özel JSON deposundan okur. |
| `api.storage.set(key, value)` | Eklentiye özel JSON deposuna yazar (toplam 1 MB). |

## İzinler
- `network`: izinli host listesi. `example.com`, `*.example.com` veya `*`.
  Boş liste = ağ erişimi yok.
- `filesystem` / `shell`: şu an **desteklenmiyor**; `true` verilse bile API
  verilmez.
- `secrets`: ayrılmıştır (henüz kullanılmıyor).

## Güvenlik
- Eklenti kodu `vm` bağlamında çalışır; `require`, `process`, `fs`, `net`,
  `electron` **doğrudan erişilemez**.
- Her eklenti ayrı bir Electron `utilityProcess`'inde çalışır; çökme izolasyonu.
- Araç çağrıları mevcut onay akışından geçer (Onaylı modda kullanıcı onayı).
- `vm` bir sert güvenlik sınırı değildir; yine de süreç + kısıtlı bağlam
  birlikte savunma katmanı sağlar.

## Kurulum
1. Repoyu GitHub'a koyun (manifest + entry).
2. EVREN Desktop → **Ayarlar → Uzantılar → Eklentiler → GitHub'dan ekle**.
3. Repo adresini yapıştırın → **İncele** → eklentiyi seçin → **Kur**.
4. **Yükle** ile aracı etkinleştirin.

## Sınırlamalar
- Yalnızca CJS; ESM (`export`) desteklenmez.
- Harici npm bağımlılığı yüklenemez (eklenti bağımsız olmalı).
- Şu an yalnızca araç kaydı vardır; UI/hook/komut API'si ileride eklenecek.
- Python/binary eklenti yok.
