# Doğrulama Kapısı ve Taze Bağlamlı İnceleme (0.4.24)

Bu belge iki değişikliği açıklar:

- **A. Doğrulama kapısı** — yazma yapan alt ajan "bitti" demeden önce
  typecheck/test **kod tarafından** çalıştırılır.
- **B. İnceleme paketi** — `review` alt ajanı, bu oturumda yapılan
  değişikliklerin diff'ini hazır bağlam olarak alır.

İkisi de aynı kaynaktan geliyor: Anthropic/Claude Code'un **deterministik
kısıt** ile **deterministik olmayan teşvik** ayrımı. Claude Code dokümanı bunu
net söylüyor:

> "If you keep adding emphasis to a CLAUDE.md line and Claude still misses it,
> that's a sign the line belongs in a hook."

Bizim 0.4.17/0.4.18 deneyimimiz de aynı: istemle "ilerleme yoksa dur" demek
yanlış tetiklendi ve işi kesti; aynı davranış kodla ölçülünce (progressGuard)
sorun çözüldü.

## 1. Sorun sınıfı

Tekrarlayan kusur: **başarısızlığı başarı gibi raporlamak.**

| Sürüm | Kusur |
|---|---|
| 0.4.14 | `task_wait` zaman aşımını hata sandı, sonucu kaybetti |
| 0.4.16 | `execute` boş sonucu başarı saydı |
| 0.4.23 | Hakem 404/kesik JSON/boş yanıtı sessizce yuttu |

0.4.24 öncesinde: `general` alt ajanı dosya yazıp "tamamlandı" diyordu.
Typecheck/test çalışıp çalışmadığını **ana ajan bilmiyordu**. Modelin
"testler geçiyor" demesi ile testlerin gerçekten geçmesi arasında hiçbir
kod bağı yoktu.

## 2. A — Doğrulama kapısı

### Akış

```
general alt ajanı
  ├─ write_file / edit_file / patch / delete_file / create_directory
  │     └─ yazma kaydedilir (mutatedPaths)
  ├─ model "bitti" der (tool_calls boş)
  │
  ├─ KAPI (kod, model değil)
  │    ├─ yazma yok          → kapı çalışmaz
  │    ├─ ajan salt-okunur   → kapı çalışmaz
  │    ├─ model run_checks'i yazmadan SONRA çalıştırdıysa → onun sonucu kanıt
  │    └─ değilse → typecheck + test çalıştır
  │
  ├─ geçti        → rapora "DOĞRULAMA: ✓ geçti"
  ├─ başarısız    → hata modele geri gönderilir (en fazla 2 tur)
  │                 model düzeltir → kapı yeniden çalışır
  └─ ölçülemedi   → rapora "DOĞRULAMA: çalıştırılmadı / doğrulanmadı"
```

### Kapı ne zaman çalışır

- Ajan **yazabildiyse** (`general`, plan dışı) **ve**
- yazma sinyali varsa:
  - `write_file` / `edit_file` / `patch` / `delete_file` / `create_directory`, **veya**
  - `run_command` / `run_python` (betik, `git checkout`, kod üreteci, `npm install`
    doğrudan yazma araçlarını kullanmadan çalışma alanını değiştirebilir; değişiklik
    günlüğü bu yolu görmez).

`run_command`'ı dâhil etmenin bedeli: komut çalıştırıp bitiren bir `general`
ajanında kapı bir kez daha koşar. Yanlışlıkla *fazla* doğrulama, sessizce
*eksik* doğrulamadan iyidir.

### Neden `typecheck` + `test`, `build` değil

`build` yavaş ve genelde typecheck/testin kapsadığı hataları tekrar eder.
Otomatik kapı hızlı olmalı; yoksa her `general` ajanı dakikalar ekler.
Model `build` gerekli görürse `run_checks` ile kendisi çalıştırır.

### Neden yalnızca yazma olduysa

Okuma/analiz ajanları (`explore`, `review`) hiç yazmadığı için kapı onlarda
**sıfır maliyet**. Kapı yalnızca sonucu değiştirebilecek ajanlarda devreye
girer.

### Ölçemediğinde başarı göstermez

| Durum | Rapor |
|---|---|
| Projede `typecheck`/`test` scripti yok | `doğrulanmadı` — asla "geçti" değil |
| Kapı çöktü (spawn hatası vb.) | `çalıştırılamadı (<neden>)` |
| Bütçe kesintisi (deadline/steps/tools) | `çalıştırılmadı — ... doğrulanmadı` |
| Modelin kendi `run_checks`'i başarısız | `BAŞARISIZ` + hata çıktısı |

### Oyunlaştırma savunması

Kapı başarısız olduğunda modele giden istem şunları açıkça yasaklar:

- testi/kontrolü silmek, `skip` eklemek, scripti değiştirmek
- hatayı susturmak

Ayrıca kapı **her turda yeniden çalıştığı için** testi silmek işe yaramaz;
yalnızca dürüstlüğü bozar. Bu, Denison et al. (2024) "Sycophancy to
Subterfuge" ve Weng (2024) "Reward Hacking" bulgularının doğrudan
uygulamasıdır: ceza baskısı altında modelin en kısa yolu ölçütü bozmaktır.

### Ana ajana görünen etiket

`spawn_agent` sonucu şu biçimde döner:

```
Alt ajan (general) sonucu [DOĞRULAMA ✓]:
...
```

veya

```
Alt ajan (general) sonucu [DOĞRULAMA BAŞARISIZ]:
...
DOĞRULAMA: ✗ BAŞARISIZ — Test (npm run test, çıkış 1)
<çıktıdan kısa alıntı>
```

Ana ajanın istemine eklenen kural: başarısız sonuçta "tamamlandı" deme,
`task_continue` ile aynı ajana düzelttir, testi gevşetmesine izin verme.

### Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `EVREN_VERIFY_GATE` | `auto` | `off` ile kapatılır (kaçış yolu) |
| `EVREN_VERIFY_TIMEOUT_MS` | `180000` | Kapı komutları için üst sınır |

`MAX_VERIFY_ROUNDS = 2`: model en fazla iki kez düzeltmeye geri gönderilir.
Daha fazlası, düzeltmeyen bir modelde yalnızca token yakar (Stroebl et al.:
doğrulayıcı ayırt etmiyorsa N'i artırmak fayda değil maliyet üretir).

## 3. B — İnceleme paketi

`review` alt ajanı geçmişsiz çalışır: kodu yazan konuşmayı görmez (Claude Code
`/code-review` ile aynı fikir). Eksik olan **neyi inceleyeceği**ydi.

0.4.24'te `review` ajanı başlatılırken:

1. `listWorkspaceChanges(30)` okunur (bu oturumda araçlarla yapılan değişiklikler).
2. Değişen dosya listesi + unified diff'ler brief'e dönüştürülür.
3. Brief istemin başına eklenir; görev metni korunur.

Sınırlar:

- Değişiklik yoksa brief boş → ajan normal görevi yapar.
- Toplam ~12.000 karakter; sığmayan dosyalar "N dosyanın diff'i sığmadı" notuyla bildirilir.
- Tek dosya diff'i 4.000 karakterde kırpılır.
- Brief, görev belirli dosyaları adlandırıyorsa onların esas alınacağını söyler
  (yanlış kapsamı incelemeyi önler).

Kazanç: inceleme ajanı diff'i keşfetmek için adım harcamaz; doğrudan kanıta bakar.

## 4. Kanıt

| Test | Kapsam | Sonuç |
|---|---|---|
| `scripts/verify-gate-test.ts` | Saf mantık + gerçek npm koşusu (geçen/başarısız/kontrolsüz) | 45/45 |
| `scripts/verify-gate-e2e-test.ts` | Yaz → başarısız kapı → geri gönderim → düzeltme → geçen kapı; kontrolsüz dürüstlük; `run_command` mutasyonu; review brief; kendi kontrolünü yeniden koşmama; kendi kontrolü başarısızsa düzeltme turu | 27/27 |
| `scripts/readonly-tools-test.ts` | Salt-okunur ajanın `patch`/`execute` kaçışları kapalı, Code Mode yazan ajanda çalışıyor | 23/23 |
| `scripts/review-brief-test.ts` | Brief biçimi, sınır, kırpma, eksik sayısı | 17/17 |
| `scripts/verify-gate-live-test.ts` | **Gerçek model**, 3 senaryo | 11/11 |

Canlı koşular (gerçek model, `deepseek-v4.1-flash`):

| Senaryo | Süre | Sonuç |
|---|---|---|
| Düzeltilemeyen test | 108 sn | `verified=false`, rapor `BAŞARISIZ` — model 2 tur denedi, geçemedi |
| Düzeltilebilir hata (`sum`) | ~60 sn | `verified=true` **ve** test gerçekten geçti; `check.js` değişmedi |
| `review` brief | ~50 sn | Diff bağlamı geldi, hedef dosya raporda |

Kapının amacı tam olarak bu: modelin iddiası değil, **ölçüm** belirler.

E2E'de doğrulanan kritik davranış: model yazdıktan sonra **ilk kapı gerçekten
başarısız oldu**, model geri gönderildi, `check.js` düzeltildi, ikinci kapı
geçti ve sonuç `verified: true` oldu.

Ayrıca: ajan kendi `run_checks`'ini yazmadan sonra çalıştırırsa kapı ikinci kez
koşmaz (`runs.txt` tek satır); kendi kontrolü başarısızsa model yine düzeltmeye
geri gönderilir ve sonuç `verified: false` kalır.

## 5. Bu sürümde kendi yakaladığımız kusurlar

Doğrulama katmanını yazarken üç sessiz hata bulundu; hepsi düzeltildi ve test
edildi:

| Kusur | Neden tehlikeli | Düzeltme |
|---|---|---|
| `review`/`explore` ajanları `patch` ile yazabiliyordu | "Salt-okunur" etiketi yalandı | `patch` engel listesine eklendi |
| Code Mode (`execute`) içinden `tools.write_file(...)` çalışıyordu | Üst düzey araç filtresi görünürde kapalı, gerçekte açık | `execute` salt-okunur ajandan çıkarıldı; sandbox API'si de süzülüyor |
| Canlı test `spawnSync(process.execPath)` ile asılı kaldı | Electron'da `execPath` = `electron.exe`; test sonsuza kadar bekledi ve **hiçbir şey yazmadı** | `runWorkspaceCommand` kullanılıyor; senaryo zaman aşımı + `unhandledRejection` raporlaması eklendi |

Üçüncüsü özellikle anlamlı: kusur, kapatmaya çalıştığımız sınıfın ta kendisiydi
— bir ölçüm aracı ölçemediğinde bunu **görünür** kılmalı. Test artık asılı
kalan senaryoyu açık bir `FAIL` olarak yazar.

## 6. Sınırlar (bilinçli)

- **Ana ajan kapıya tabi değil.** Ana döngüde de yazma olabilir; orada kapı
  henüz yok. İstemde `run_checks` önerilir ama garanti değildir. Sonraki adım
  adayı: ana ajanın `finalize` yolunda aynı kapı.
- **Yalnızca Node/npm kontrolleri** otomatik algılanır (`package.json`
  scriptleri + `tsconfig.json`). Python/Go/Rust için `run_checks` henüz
  genişletilmedi.
- **Kapı yalnızca "testler geçti" der, "görev doğru yapıldı" demez.** Test
  kapsamı zayıfsa kapı bunu bilemez. Bu yüzden `review` katmanı ayrı duruyor.
- **Kapı, alt ajanın yazdığı dosyaları geri almaz.** Sahiplik ve checkpoint
  mekanizması (0.4.13) hâlâ tek geri alma yolu.
