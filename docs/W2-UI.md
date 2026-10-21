# W2 — Planlama ve Güvenli Çalışma UI

Bu sürümde ana sohbet ekranını büyütmeden dört özellik eklendi:

1. **Plan / Build modu**
2. **Kalıcı görev listesi**
3. **Kategori bazlı izinler + “Her zaman izin ver”**
4. **Adım bazlı checkpoint / geri alma**
5. **`@dosya` bağlamı**

## UI referansları

| Kaynak | Alınan fikir |
|---|---|
| Cursor Plan Mode (`Shift+Tab`) | Composer’da kompakt Plan/Build anahtarı; plan modunda değişiklik yapılmaz. |
| Claude Desktop | Sağ tarafta görev paneli, izin kartında “Bir kez / Her zaman / Reddet”, dosya bağlamı çipleri. |
| Cline Checkpoints | Her araç adımından sonra geri alınabilir checkpoint; sohbet korunur. |
| OpenCode Permissions | Kategori bazlı `allow / ask / deny`; plan modunda yazma/komut kapalı. |
| OpenCode Agents | Plan ajanı read-only; todo ve plan çıktısı. |

## Ekran düzeni

- **Composer alt satırı:** `Build/Plan` pill’i, `@ Dosya` düğmesi. Plan modunda
  küçük bir “Değişiklik yapmadan analiz eder” ipucu ve **Planı uygula** düğmesi.
- **Sağ panel:** İnceleme / Dosyalar / Görevler. Aynı anda yalnızca biri açılır.
- **Görevler:** İlerleme çubuğu, tıklanabilir durum ikonları, “Listeyi temizle”.
- **İzinler:** Ajan panelinde katlanır “İzinler (gelişmiş)” bölümü; her kategori
  için `Sor / İzin / Engelle`.
- **Checkpoint:** Dosya aracı kartında “↶ Bu adımı geri al”; ilgili adımdaki tüm
  dosya değişikliklerini geri alır.
- **@ dosya:** `@` yazınca veya **@ Dosya** ile açılan popover; seçilen dosya
  gönderim sırasında model bağlamına eklenir.
- **Dosya eki:** **📎 Ekle**, sürükle-bırak veya panodan yapıştırma. Metin
  dosyaları bağlama eklenir; görseller vision destekli modellerde `image_url`
  olarak gönderilir. En fazla 5 ek / 8 MB.

## Teknik notlar

- `AgentProfile = 'build' | 'plan'`; plan modunda `createTools({ readOnly: true })`
  yazma/komut/bilgisayar araçlarını kayıttan çıkarır.
- `PermissionSettings` kategorileri: `read`, `edit`, `execute`, `browser`, `mcp`,
  `computer`. Varsayılan, Onaylı modda `ask`, Otomatik modda `allow`; plan modunda
  `edit/execute/computer` her zaman `deny`, `mcp` `ask`.
- `todo_write` aracı `ToolResultInfo.todos` ile UI’ya döner; oturumda
  `Session.todos` olarak saklanır.
- Workspace yedekleri `checkpointId` ile gruplanır; `restoreWorkspaceCheckpoint`
  adımdaki değişiklikleri tersten geri yükler.
- `@dosya` bağlamı gönderim anında `workspace.read` ile okunur; sohbet balonunda
  yalnızca `@path` görünür.
