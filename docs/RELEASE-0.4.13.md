# 0.4.13 Beta — dosya sahipliği (Katman A), iki sessiz hata düzeltmesi

Paralel kodlama artık güvenli: iki alt ajan **aynı dosyaya yazamaz**. Bu bir
istem kuralı değil, kod garantisi.

## Neden worktree değil

`docs/WORKTREE-DECISION.md` ölçümleri: `git worktree add` hızlı (493 ms) ama
worktree yalnızca **izlenen** dosyaları görür — `plc_proje`'de 373/16 253
(%2,3) — ve `.env`, `secrets.h`, `node_modules`, `.dart_tool` **gelmez**.
Yani sır taraması ve `run_checks` worktree'de çalışmaz.

Worktree'nin çözdüğü tek sorun iki ajanın aynı dosyaya yazmasıdır. Bu sorunu
%1 maliyetle çözen daha basit bir yol var: **her dosyanın tek sahibi olsun.**
Worktree, Katman B olarak opt-in kalıyor.

## Nasıl çalışır

1. Ana ajan `spawn_agent` çağırırken `files` listesi verir: o ajanın
   yazabileceği yollar.
2. Çakışan bir yol zaten sahipliyse spawn **reddedilir** ve modele
   "şu dosya X ajanında" denir.
3. Sahip olunan yollar ajana **yazma izni** olarak geçirilir; liste dışına
   yazma denemesi araç düzeyinde reddedilir.

Sonuç: çakışma *tespit edilmez*, **imkânsız olur**. Ajanlar aynı ağaçta
çalışır — `node_modules`, `secrets.h`, `run_checks` hepsi yerinde kalır.

Yol desenleri: `src/a.ts` (tek dosya), `src/module/` (dizin ağacı),
`src/**/*.ts` (glob). Eşleşme iki yönlü kontrol edilir; iki desen yalnızca
statik önekleri kesişiyorsa çakışır (bu yüzden `src/auth/` ile `src/billing/`
birbirini engellemez).

## Canlı sınama (gerçek model, üretim yolu)

6 dosyalı, iki bağımsız modüllü proje. Görev açıkça iki general alt ajana
bölündü.

| | |
|---|---|
| Süre | **235 sn** |
| `spawn_agent` | 2 (ikisi de kabul) |
| Sahiplik | `["src/auth/"]` + `["src/billing/"]` — çakışma **0** |
| Yazma | 6 (`write_file`/`edit_file`) |
| Sonuç | 6/6 hata düzeltildi |

Model, `files` listesini kendiliğinden doğru verdi; iki modül paralel
düzeltildi ve hiçbir ajan diğerinin dosyasına dokunmadı.

## Yol boyunca bulunan iki sessiz hata

### 1. Eşzamanlılık kapısı sızıntısı

Dosya doğrulaması `subagentGate.acquire()`'dan **sonra** yapılıyordu. Reddedilen
bir spawn slotu geri vermiyordu:

- files'sız bir `general` reddedildi → slot sızdı
- kapasite (varsayılan 2) yarıya indi
- meşru spawn'lar kuyruğa girdi, ajanlar **sırayla** koştu
- sırayla koşunca sahiplik bırakıldı ve çakışma hiç oluşmadı

Teşhis izleri claim'lerin 13 sn arayla alındığını gösterdi. Düzeltme: doğrulama
kapıdan önce; çakışma reddi `refund()` ile slot **ve** bütçeyi iade eder
(`agent-subagent-limit-test` §14).

### 2. Alt ajan `tool-result` hiç yayınlamıyordu

Alt ajanlar `tool-call` gönderiyor ama sonucu göndermiyordu. Sonuç: arayüz alt
ajanın aracı ne ile bitirdiğini gösteremiyor, testler sahiplik ihlalini
gözemiyordu. `ToolResultInfo` artık `agentType`/`subagentTaskId` taşıyor ve
sonuç her yolda (izin reddi, onay reddi, başarı, hata) yayınlanıyor.

## Test

| Paket | Kontrol | Kapsam |
|---|---|---|
| `file-ownership-test` | 52 | Normalizasyon, glob/dizin çakışması, tablo atomikliği, yazma izni |
| `file-ownership-enforce-test` | 14 | Araç düzeyi zorlama (write/edit/delete, gerçek dosyalar) |
| `file-ownership-loop-test` | 12 | Döngü düzeyi: files zorunlu, çakışma reddi, kapı sızıntısı |
| `agent-subagent-limit-test` | +4 | `refund()` slot ve bütçe iadesi |

Toplam: **64 paket / 1511 kontrol** (önceki 61/1429). typecheck ✓ build ✓ e2e ✓
Canlı model sınaması ✓ (yukarıda).

## Bilinen sınırlar

- Sahiplik yalnızca **eşzamanlı** ajanlarda anlamlıdır. Ön plan ajanları
  sırayla koşup sahipliği bırakır; bu doğru davranıştır.
- `general` ajan `files` vermezse spawn reddedilir (yazma yapan ajanın
  sahipliği bilinmeden paralellik kurulamaz).
- SignPath Foundation başvurusu Ekim 2026'da reddedildi; bu beta installer
  imzasızdır. Windows SmartScreen "Bilinmeyen yayıncı" uyarısı gösterebilir.
