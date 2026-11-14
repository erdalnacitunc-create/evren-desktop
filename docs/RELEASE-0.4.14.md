# 0.4.14 Beta — alt ajan bekleme kusuru, devam ettirme, ayrıntılı izleme

Canlı takipte iki kusur bulundu ve düzeltildi; alt ajanlar artık opencode/Claude
Code ile aynı davranış modelini izliyor. Karşılaştırma:
`docs/SUBAGENT-ARCHITECTURE.md`.

## Düzeltilen iki kusur

### 1. `task_wait` zaman aşımı "hata" olarak dönüyordu

Canlı koşu (medicast, 14 Kasım):

| | |
|---|---|
| Alt ajan başlangıcı | 09:41:13 |
| `task_wait` (120 sn) | 09:43:11 → **`ok:false`** + tüm görev JSON'u |
| Alt ajanın gerçek bitişi | 09:44:19 (186 sn) |
| Üretilen sonuç | 4820 kr |
| Ana ajanın aldığı | **hiç** ("Kotlin alt ajanı sonuç dönmedi") |

Sonuç `subagent-tasks.json`'da duruyordu ama ana ajan görmedi: `ok:false`
kalıcı hata sanıldı ve JSON yankısı (görev istemi dâhil) 800+ kr bağlam yaktı.

Artık sürüyorsa `ok:true` + "hâlâ çalışıyor, bu bir hata değil" + canlı
ilerleme döner. İstem asla yankılanmaz.

### 2. İlerleme güncellemesi `task_wait`'i erken uyandırıyordu

Yeni ilerleme alanı eklenirken ortaya çıktı: `updateSubagentTask` her
güncellemede bekleyenleri uyandırıyordu. Model "hâlâ çalışıyor" cevabını
sonuç sanabilirdi. Artık yalnızca durum/sonuç/hata değişiminde uyanır
(`subagent-wait-test` bunu sabitler).

### 3. Kısmi sonuç işareti (doğrulama)

`partial`/`partialReason` kayıt → durum → sonuç zincirinde uçtan uca taşınıyor;
`task_continue` ve `retrySubagentTask` yolları da kapsandı.

## Yeni yetenekler

### Tur içi alt ajan bildirimi

opencode'un `<subagent>` mesajı gibi: arka plan görevi biterken ebeveyn hâlâ
çalışıyorsa bir sonraki adımda konuşmaya `system` iletisi eklenir. Model
beklemeden sonucu kullanabilir.

### `task_continue`

Biten veya kısmi kalan ajan **aynı görev** üzerinde sürdürülür: önceki istem ve
sonuç bağlam olarak verilir, `attempts` artar, general ajanın dosya sahipliği
yeniden alınır. Claude Code `resume`, opencode aynı `sessionID` karşılığı.

### `task_logs` ve yapılandırılmış izleme

`<userData>/logs/subagent-events.jsonl` (4 MB'da döner) her araç çağrısını
**süresiyle**, her bütçe kesintisini, her izin/araç hatasını ve durum geçişini
kaydeder. Sırlar maskelenir. Model `task_logs` ile bir görevin neden takıldığını
görebilir.

### `description` ve kompakt durum

`spawn_agent` artık kısa `description` alır (arayüz + günlük). `task_status`
tam kayıt yerine kompakt özet + canlı ilerleme döndürür; `task_list` de kısaldı.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `subagent-log-test` | 21 | Yazma, sorgu, özet, maskeleme, kırpma, döndürme |
| `subagent-wait-test` | 21 | Zaman aşımı, sonuç, kompakt durum, `task_continue`, bildirim, `task_logs` |
| `agent-subagent-limit-test` | 46 | Kapı, bütçe, `refund` |
| `file-ownership-*` | 78 | Sahiplik, araç zorlaması, döngü |

Toplam: **66 paket / 1553 kontrol** (önceki 64/1511). typecheck ✓ build ✓ e2e ✓

## Bilinen sınırlar

- Büyük alt ajan çıktısı hâlâ 12 000 karakterde kırpılır; dosyaya artefakt
  yazma ertelendi (gerekçe: `docs/SUBAGENT-ARCHITECTURE.md`).
- Ajan başına araç allowlist yok; üç sabit tür + `readOnly` kullanılıyor.
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
