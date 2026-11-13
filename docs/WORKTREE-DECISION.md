# Worktree izolasyonu — kanıta dayalı karşılaştırma

> Durum: **karar belgesi**. Kod yok. Amaç: alt ajan tetiklemelerinde en hızlı ve
> en verimli yapıyı seçmek.
> Kaynaklar: `code.claude.com/docs/en/{worktrees,agents,agent-teams,workflows}`,
> `sub-agents`, OpenAI rate-limit rehberi, Cognition "Don't Build Multi-Agents",
> Anthropic "How we built our multi-agent research system" + kendi kodumuz.

## 0. Önce bir düzeltme

Sorunuzdaki varsayım: *"worktree, Claude Code'un kullandığı ve dünyada en çok
kullanılan yapı."*

**Bu doğru değil.** Claude Code dokümantasyonu açıkça şöyle diyor:

> "Worktrees are one of several ways to run Claude in parallel. **They isolate
> file edits.** Subagents split work up inside one session…"

Yani worktree bir *paralel çalıştırma yöntemi* değil, bir **izolasyon
ilkesi**. Ve Claude Code'da:

- **Varsayılan alt ajan worktree KULLANMAZ.** Aynı dizinde çalışır.
- Worktree yalnızca açıkça istenirse açılır: alt ajan tanımına
  `isolation: worktree` yazılırsa, ya da kullanıcı "ajanların için worktree
  kullan" derse.
- Worktree asıl olarak **paralel oturumlar** (senin açtığın ayrı terminaller)
  ve **`/batch`** için kullanılır.

Claude Code'un paralel çalışma için beş ayrı yolu var ve worktree bunların
hiçbiri değil, hepsinin altında duran bir katman:

| Yaklaşım | Ne yapar | Worktree kullanır mı |
|---|---|---|
| **Subagents** | Tek oturum içinde devredilen işçiler | ❌ varsayılan; ⚠️ `isolation: worktree` ile evet |
| **Agent view** | Arka plan oturumlarını tek ekrandan yönet | ✅ düzenlemeden önce worktree'ye girer |
| **Agent teams** | Paylaşılan görev listesi + ajanlar arası mesajlaşma | ❌ (dosya paylaşımını *bölümleyerek* çözer) |
| **Dynamic workflows** | Script'in yönettiği 10-100 ajan | ✅/❌ script'e bağlı |
| **Projects** | Günler süren, bulutta süren iş | ✅ |

Yani "worktree = en çok kullanılan yapı" değil; **"worktree = yazma
çakışmasını çözen tek araç."** Doğru soru şu: *bizde yazma çakışması sorunu var
mı?*

## 1. Worktree gerçekte neyi çözer, neyi çözmez

### Çözdüğü: aynı dosyaya eşzamanlı yazma

```
Ajan A: firmware/config.h yazıyor
Ajan B: firmware/config.h yazıyor     → son yazan kazanır, diğeri kaybolur
```

Worktree ile her ajan kendi kopyasında yazar; çakışma fiziksel olarak imkânsız.

### Çözmediği: arayüz tutarsızlığı

```
Ajan A: async function yukle() { ... }        (kendi kopyasında)
Ajan B: function yukle() { ... }              (kendi kopyasında)
```

İkisi de kendi kopyasında **doğru** çalışır. Birleştirme anında çelişki ortaya
çıkar. Worktree bunu **gizler, çözmez** — hatta daha kötü: çakışma derleme
anında değil, merge anında patlar.

Cognition'ın uyarısı tam bu: *"Actions carry implicit decisions, and conflicting
decisions carry bad results."* Worktree, çelişen kararları **daha uzun süre
görünmez** kılar.

### Bedeli (Claude Code'un kendi dokümanından)

| Bedel | Ayrıntı |
|---|---|
| **Node_modules yok** | Worktree taze checkout; `npm install` gerekir. Her ajan için. |
| **Gitignored dosyalar yok** | `.env` vb. için `.worktreeinclude` yazmak gerekir |
| **Git LFS bozuk** | Repo'da `git lfs install --local` varsa worktree'de **pointer dosyaları** gelir |
| **Kilit/yarış** | `git worktree lock`, `index.lock` hataları (alt dizinden çalıştırınca) |
| **Disk** | Her worktree tam çalışma kopyası |
| **Temizlik** | Değişiklik varsa silinmez; periyodik süpürme gerekir |
| **Windows'a özel** | Junction/symlink davranışı, yol uzunluğu |
| **Sadece git** | Git reposu değilse `WorktreeCreate` hook'u yazmak gerekir |
| **Kısmi klon** | Partial clone'da worktree oluşturma başarısız olabilir |

## 2. Bizim mevcut durumumuz (koddan)

Bunu 0.4.12'de eksik anlatmışım. Gerçek durum daha iyi:

| Bileşen | Durum |
|---|---|
| `git.ts` → `addGitWorktree`, `removeGitWorktree`, `listGitWorktrees` | ✅ **zaten var** |
| `git` aracı → `worktree_add`, `worktree_remove`, `worktree_list` | ✅ **modele açık** |
| `workspace.ts` → checkpoint/backup + `restoreWorkspaceCheckpoint` + `undoWorkspaceChange` | ✅ dosya düzeyi geri alma |
| Alt ajan yazma yetkisi (`general`) | ✅ var |
| Alt ajan ↔ worktree bağı | ❌ **yok** (ilkel var, bağlantı yok) |
| Dosya sahipliği tablosu | ❌ yok |
| Yazma çakışması tespiti | ❌ yok |

**Kritik bulgu:** worktree ilkelleri hazır. Eksik olan tek şey *bağlantı*.
Yani "worktree'yi inşa etmek" değil, "alt ajana atamak" işi.

### Ama bizde worktree'yi **evrensel** yapmayı engelleyen iki gerçek

**1. Çalışma alanı çoğu zaman git reposu değil.** `createTemporaryWorkspace()`
var ve canlı koşuda model tam olarak geçici klasörde çalıştı. Git reposu
olmayan yerde worktree **oluşturulamaz**.

**2. İş yükümüz şu an neredeyse tamamen okuma.** Son 6 canlı koşuda:

| Koşu | Yazma aracı | Okuma aracı |
|---|---|---|
| plc_proje 0.4.10 | **0** | 8 |
| plc_proje 0.4.11 | **0** | 12 |
| web araştırması | **0** | 7 |
| dual test (yerel) | **0** | 12 |
| dual test (web) | **0** | 7 |

**Yazma oranı: %0.** Okuma işinde worktree **saf maliyet** — hiçbir çakışma
yaratmaz, ama her ajan için checkout + kurulum ödetir.

## 3. Suçlu: worktree değil, yanlış yerde aranan çözüm

Sizin sorunuzun altında yatan gerçek ihtiyaç şu: *"paralel alt ajanlar
birbirinin işini bozmasın ve hızlı olsun."* Worktree bunun **bir** cevabı, ama
en pahalısı.

Dört maliyet seviyesi var:

| Seviye | Mekanizma | Çakışmayı çözer | Maliyet | Ne zaman |
|---|---|---|---|---|
| **0** | **Salt-okunur alt ajan** | Çakışma imkânsız | 0 | Keşif, inceleme, araştırma |
| **1** | **Dosya sahipliği** | Aynı dosya iki ajana verilmez | ~0 | Paralel yazma, ayrık dosyalar |
| **2** | **Checkpoint + geri alma** | Çakışma olur, geri alınır | düşük | Bizde **var** |
| **3** | **Worktree** | Fiziksel izolasyon | **yüksek** | Ayrık dosyalar + aynı anda çok yazma + git reposu |

Bizim iş yükümüz %100 seviye 0. Kodlama geldiğinde seviye 1 yeterli olacak.
Seviye 3 ancak şu üçü **aynı anda** doğruysa gerekli:

1. Görev **yazma** ağırlıklı (kod üretiyor)
2. Yazmalar **gerçekten paralel** (2+ ajan aynı anda)
3. Çalışma alanı **git reposu**

## 4. Hız karşılaştırması — GERÇEK ölçüm

`plc_proje` üzerinde ölçtüm (13 Kasım 2026, bu makine):

| Ölçüm | Değer |
|---|---|
| Depo toplamı | **16 253 dosya / 6,47 GB** |
| Git izlenen dosya | **373** (%2,3) |
| `git worktree add --detach HEAD` | **493 ms** |
| Worktree boyutu | **374 dosya / 0,01 GB** |
| `git worktree remove --force` | **197 ms** |

İlk tahminim yanlıştı: worktree oluşturma **dakikalar değil, yarım saniye**
sürüyor — çünkü git yalnızca izlenen dosyaları çıkarıyor, 6,47 GB'ın
%97,7'si (build artefaktları) zaten dışarıda.

**Ama bu hız bir tuzak.** İki gerçek sorun ortaya çıkıyor:

### Sorun 1 — Worktree projenin %2,3'ünü görüyor

Ajanın göreceği proje:

```
var: 373 dosya  (kaynak kod, dokümanlar)
yok: 15 880 dosya (build artefaktları)
```

Okuma için bu **iyi** (gürültü yok). Ama:

### Sorun 2 — İhtiyaç duyulan dosyalar tam olarak eksik

`.gitignore` içeriği:

```
.env                              → worktree'de YOK
araclar/.env                      → YOK
bulut/.env                        → YOK
firmware/include/secrets.h        → YOK
firmware/include/dinleyici_gizli.h → YOK
```

Yani **sır taraması** görevi verildiğinde ajan, tam da araması gereken
dosyaları göremez. Claude Code bunun için `.worktreeinclude` dosyasını
yazmış; bizde böyle bir mekanizma yok.

Ayrıca:

| Bağımlılık | Repo'da | Worktree'de |
|---|---|---|
| `mobil/.dart_tool` (117 MB) | var | **yok** |
| `firmware/.pio` (libdeps dahil) | var | **yok** |
| `node_modules` | yok | yok |

Sonuç: worktree'de `run_checks` çalışmaz. Ajan test/derleme doğrulaması
yapamaz — yani **kod yazıp doğrulayamaz**. Bu, kodlama devrinde worktree'nin
en büyük bedeli: 493 ms'lik kurulum değil, ardından gelen `flutter pub get` /
`pio run` / `npm install` dakikaları.

### Karşılaştırma tablosu (ölçülmüş + tahmin ayrımıyla)

| Senaryo | Mevcut | Worktree zorunlu | Fark |
|---|---|---|---|
| plc_proje analizi (12 araç, 0 yazma) | **169 sn** (ölçüldü) | 169 sn + 0,5 sn + **eksik dosyalar** | Aynı hız, **daha az bilgi** |
| Web araştırması | 384 sn (ölçüldü) | değişmez | worktree alakasız |
| Kısa kodlama görevi (tek modül) | — | +0,5 sn kurulum + **dakikalarca `pub get`** | **daha yavaş** |
| 3 ayrık modülde paralel kodlama | — | +1,5 sn kurulum + 3× bağımlılık | Tek gerçek kazanç |

> **Sonuç: worktree oluşturmak ucuz (0,5 sn), ama kullanmak pahalı.**
> Okuma işinde sıfır fayda / daha az bilgi; kodlamada bağımlılık kurulumu
> dakikalar alır. Evrensel yapmak bizi hızlandırmaz.


## 5. Claude Code'un kodlama için gerçek deseni

Kodlamada çok dosyalı devri Claude Code nasıl yapıyor? Worktree'yi "her alt
ajana" vermiyor. `/batch` skill'i:

> "`/batch` … has Claude split one large change into **5 to 30
> worktree-isolated subagents**."

Dikkat: burada worktree **değişikliğin bölünmesiyle** birlikte geliyor. Yani
worktree tek başına değil, "her ajan ayrı dosya kümesi + kendi kopyası" olarak.

Ve Agent teams için doküman ne diyor?

> "Agent teams **don't isolate teammates in worktrees**, so **partition the
> work so each teammate owns a different set of files**."

Yani Claude Code'un kendi ekibinde bile önce **dosya sahipliği**, sonra
(gerekirse) worktree. Sıra bu.

## 6. Öneri: üç katmanlı, artımlı

### Katman A — şimdi (ucuz, yüksek fayda)

**Salt-okunur varsayılan + sahiplik tablosu.**

- `explore`/`review` zaten salt-okunur ✅
- `general` yazacaksa: ana ajan spawn öncesi **dosya sahipliği** tutar
- İki ajana aynı dosya verilmezse çakışma **imkânsız** (worktree'ye gerek yok)
- Maliyet: ~0. Kurulum yok, disk yok, git şartı yok

Bu, worktree'nin çözdüğü sorunun **%90'ını %1 maliyetle** çözer.

### Katman B — gerçek ihtiyaç doğduğunda

**`general` + `isolation: 'worktree'` seçeneği (opt-in).**

İlkeller hazır (`addGitWorktree`). Yapılacak: spawn sırasında worktree aç,
ajanın `workspaceRoot`'unu oraya çevir, bitince diff'i ana ajana döndür.
Varsayılan **kapalı**; yalnızca:

- görev yazma ağırlıklıysa **ve**
- 2+ ajan gerçekten paralel yazacaksa **ve**
- çalışma alanı git reposuysa

### Katman C — asla varsayılan yapılmayacak

- Okuma işlerinde worktree (saf maliyet)
- Git olmayan çalışma alanında worktree (imkânsız)
- Tek modüllü seri düzenlemede worktree (yavaşlatır)

## 7. Karar

> **Worktree'yi evrensel yapmıyoruz.** Okuma işlerinde alt ajanlar paylaşılan
> salt-okunur bağlamda çalışmaya devam eder (en hızlı). Yazma işlerinde önce
> **dosya sahipliği** gelir; worktree, gerçek paralel yazma ihtiyacı doğduğunda
> **opt-in** bir seçenek olarak açılır.

Gerekçe üç madde:

1. **Hız:** iş yükümüz %100 okuma; worktree her ajan için checkout + kurulum
   ödetir, hiçbir çakışma önlemez.
2. **Kanıt:** Claude Code da varsayılan alt ajanda worktree kullanmıyor;
   `/batch` ve agent teams'de önce **dosya bölümlemesi** yapıyor.
3. **Uygunluk:** çalışma alanımız çoğu zaman geçici klasör (git yok) —
   worktree teknik olarak mümkün değil.

## 8. Açık sorular (cevaplanmadan kod yazılmamalı)

1. **Gerçek paralel yazma ihtiyacı ne zaman doğacak?** Bugünkü kullanım
   (analiz, araştırma, inceleme) hiç yazma üretmiyor. Kullanıcı "3 modülde
   paralel özellik yaz" dediğinde mi? Yoksa hiç?
2. **Çalışma alanı git reposu mu olacak?** Şu an geçici klasör varsayılanı var.
   Kullanıcı "Klasör Seç" ile kendi reposunu seçerse worktree mümkün.
3. **Windows'ta ölçüm:** ✅ ölçüldü — `git worktree add` = **493 ms**, 373/16253
   dosya (%2,3). Hızlı. Asıl maliyet bağımlılık kurulumu ve eksik dosyalar.
4. **Merge stratejisi:** worktree'lerden dönen diff'leri ana ajan nasıl
   uygular? Otomatik mi, onaylı mı, çakışırsa ne olur?
5. **`.worktreeinclude` karşılığı:** `.env`, `secrets.h` gibi gitignored ama
   gerekli dosyalar worktree'ye nasıl taşınır? Taşınmazsa sır taraması
   görevleri worktree'de **çalışmaz**.
6. **Bağımlılık önyüklemesi:** worktree'de `pub get`/`pio run`/`npm install`
   dakikalar alır. Bunu önlemek için worktree'ye `node_modules`/`.dart_tool`
   junction/symlink ile bağlanabilir mi? Windows'ta bu güvenli mi?

