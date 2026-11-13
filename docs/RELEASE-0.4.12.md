# 0.4.12 Beta — iki canlı sınama, web araştırma ipucu, kodlama devri analizi

İki sorgu üretim yolundan (gerçek model, gerçek ağ/disk) çalıştırıldı ve canlı
ölçüldü.

## Sınama sonuçları

### Sorgu 1 — yerel plc_proje (çalışma alanı = `C:\...\plc_proje`)

| | |
|---|---|
| Süre | **169 sn** |
| Araç | 12 (`read_file` 7, `glob` 2, `list_files` 1, `repo_map` 1, `run_command` 1) |
| Alt ajan | **0** |
| Retry | 0 |
| Rapor | 6303 kr, 7 katmanlı tablo, dosya referansları |

Model `repo_map` ile haritayı çıkardı, `read_file` ile 7 kritik dosyayı
(00_genel_felsefe, 05_katman_haritasi, platformio.ini …) **içerikten** okudu ve
katmanları koda eşledi. Alt ajan gerekmedi — devretmemek doğru karardı.

### Sorgu 2 — web araştırması (benzer proje)

| | |
|---|---|
| Süre | **384 sn** |
| Araç | 7 (`websearch` **4**, `execute` 2, `todo_write` 1) |
| Alt ajan | **0** |
| Retry | 0 |
| Rapor | 5578 kr, 5 katmanlı mimari tablosu |

4 arama **sırayla** yapıldı. Aradaki fark net:

| Sorgu | Süre | Neden |
|---|---|---|
| Yerel (paralel dosya okuma) | 169 sn | `read_file` 7 dosyayı tek adımda okudu |
| Web (sıralı arama) | **384 sn** | 4 bağımsız arama tek tek |

## Bulgu: web araştırması için devretme kuralı yoktu

Dosya keşfi için ipucu vardı (`Keşif ipucu: N dosya listelendi…`), web için
**hiçbir sinyal yoktu**. `explorationHint` yalnızca `list_files`/`glob`/`grep`
ve `read_file`/`repo_map`/`code_search` sayıyordu — `websearch` kapsam dışıydı.

Sonuç: 4 bağımsız arama 384 saniyede sırayla yapıldı; paralel alt ajanlarla
~100 saniyeye inebilirdi.

### Düzeltme

**1. Web araştırma ipucu** (`explorationHint.ts`):

```ts
shouldHintWebResearch(state, hintsSent, maxHints=1, minSearches=3)
```

3+ web araması yapıldıysa ve henüz alt ajan açılmadıysa modele tek seferlik
hatırlatma gider:

> DURUM: Birkaç web aramasını sırayla yaptın.
> Bu aramalar birbirinden bağımsızsa **paralel** alt ajanlarla çok daha hızlı
> tamamlanır: 2-4 `explore`, her birine **FARKLI** konu ve farklı kaynak türü
> (resmî dokümantasyon, GitHub, teknik blog), sonuçları `task_wait` ile topla…
> Aramalar birbirine bağlıysa bu ipucunu yok say.

**2. Devretme kuralına web maddesi**:

> Web araştırmasında 3+ bağımsız konu varsa (farklı teknoloji, farklı kaynak
> türü) → 2-4 `explore` paralel; her birine farklı konu ve kaynak türü ver.

## Kodlama devri: mimari uygunluk analizi

Sorunuz: model, kodlama görevini farklı dosyalara alt ajanlarla dağıtabilir mi?
Kodu denetledim.

### Teknik cevap: evet, kısmen

| Alt ajan türü | Yazma yetkisi | Nasıl |
|---|---|---|
| `explore` | **Hayır** | `readOnly = true` sabit |
| `review` | **Hayır** | `readOnly = true` sabit |
| `general` | **Evet** | `readOnly = agentType !== 'general' \|\| profile === 'plan'` |

Yani `general` alt ajanı `write_file`/`edit_file`/`run_command` kullanabilir ve
**farklı dosyalarda gerçekten kod yazabilir**. Ana ajan paralel `general`
ajanları başlatabilir.

### Ama mimari bunun için **hazır değil** — üç somut eksik

**1. Yazma çakışması koruması yok.** Kodu taradım: alt ajanlar için worktree
izolasyonu, dosya kilidi veya çakışma tespiti **yok**. İki `general` ajanı aynı
dosyaya yazarsa son yazan kazanır, diğeri sessizce kaybolur.

**2. Ana ajan ne yazıldığını görmüyordu.** Alt ajan yalnızca metin özeti
döndürüyordu; `diff` yoktu. Kodlama devrinde bu "kara kutu" demek: ana ajan
"3 dosya düzenledim" diyen bir özete güvenmek zorundaydı. **Bu sürümde
düzeltildi** — `general` ajan sonucuna değişen dosya listesi ekleniyor:

```
Değişen dosyalar (3):
- firmware/ana/config.h (düzenlendi)
- bulut/edge/index.ts (yazıldı)
- crm/sunucu.py (silindi)
```

**3. Ajanlar birbirinin kararını görmüyor.** Bu bilinçli (Cognition ilkesi:
örtük kararlar çelişir). Ama kodlamada sonucu daha ağır: iki ajan farklı dosyaya
**tutarsız** stil/arayüz yazabilir — biri `async`, diğeri `sync`; biri aynı
yardımcıyı kendi kopyasıyla, diğeri import'la. Derleme geçer, mimari bozulur.

### Mevcut hâliyle ne yapılabilir, ne yapılmamalı

| Görev | Uygun mu | Neden |
|---|---|---|
| Sır/güvenlik taraması (salt-okunur) | ✅ | `explore`/`review`, çakışma yok |
| Keşif: "bu değişiklik nereleri etkiler" | ✅ | salt-okunur |
| Test yazımı (ayrı test dosyaları) | ⚠️ | dosya ayrımı netse çalışır |
| Aynı modülde çoklu dosya düzenleme | ❌ | çakışma + tutarsızlık riski |
| Büyük refactor (paylaşılan arayüz) | ❌ | ajanlar arayüzü ayrı ayrı yorumlar |
| Bağımsız modüllerde paralel özellik | ⚠️ | ancak dosya sahipliği kesin ayrılırsa |

### Önerilen tasarım: sahiplik + worktree

Kodlama devrini güvenli kılmak için üç katman gerekir:

**a) Dosya sahipliği (zorunlu, ucuz).** Her `general` ajana **ayrı dosya
kümesi** atanır. Ana ajan spawn öncesi sahiplik tablosu tutar; iki ajana aynı
dosya verilmez. Çakışma isteği reddedilir (`spawn_agent` hatası).

**b) Worktree izolasyonu (güçlü, orta maliyet).** Her ajana `git worktree` ile
ayrı çalışma kopyası; sonuçta diff'ler ana ajana döner, ana ajan seçip uygular.
Claude Code tam bunu yapıyor (`isolation: worktree`).

**c) Arayüz sözleşmesi (tutarlılık).** Ana ajan spawn metnine paylaşılan
arayüzü (tip imzaları, yardımcı fonksiyon adları) yazar; ajanlar onu kullanır.

Bugün **a ve c** istemle kısmen yapılabilir; **b** kod gerektirir. Önerim:
önce (a) sahiplik tablosu — küçük ve ölçülebilir; (b) ancak gerçek bir çok
dosyalı refactor ihtiyacı doğduğunda.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `web-research-hint-test` | 22 | Eşik, sayaç, yapılandırma, metin kalitesi |

Toplam: **61 paket / 1429 kontrol** (önceki 60/1407). typecheck ✓ build ✓ e2e ✓
