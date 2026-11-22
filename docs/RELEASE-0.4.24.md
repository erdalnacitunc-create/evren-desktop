# 0.4.24 Beta — doğrulama kapısı + taze bağlamlı inceleme

Bu sürüm, alt ajan mimarisinde **ölçümün kendisini** güçlendiriyor. Yeni
yetenek eklemiyor; yanlış "bitti" raporlarını yapısal olarak kapatıyor.

## Neden

0.4.23'e kadar `general` alt ajanı dosya yazıp "tamamlandı" diyebiliyordu.
Typecheck/test çalışıp çalışmadığını ana ajan bilmiyordu. Modelin "testler
geçiyor" demesi ile testlerin gerçekten geçmesi arasında **kod bağı yoktu**.

Bu, projenin tekrarlayan kusur sınıfının devamıydı: başarısızlığı başarı gibi
raporlamak (0.4.14 `task_wait`, 0.4.16 boş `execute`, 0.4.23 sessiz hakem).

## 1. Doğrulama kapısı (deterministik kısıt)

Claude Code'un `Stop` hook'unun karşılığı:

- `general` alt ajanı **dosya yazdıysa** ve "bitti" dediyse,
- sistem (model değil) `typecheck` + `test` çalıştırır,
- geçmezse model en fazla **2 tur** düzeltmeye geri gönderilir,
- sonuç rapora eklenir: `DOĞRULAMA: ✓ geçti` / `✗ BAŞARISIZ` / `doğrulanmadı`.

Kapı, modelin kendi `run_checks` sonucunu (yazmadan sonra çalıştıysa) kanıt
olarak kabul eder; aynı kontrol iki kez koşmaz.

**Ölçemediğinde başarı göstermez:** kontrol tanımlı değilse, kapı çöktüyse
veya bütçe kesintisi olduysa rapor "doğrulanmadı" der. "Geçti" demez.

**Oyunlaştırma savunması:** düzeltme istemi testi silmeyi/gevşetmeyi açıkça
yasaklar; kapı her turda yeniden koştuğu için testi silmek işe yaramaz.

## 2. İnceleme paketi (taze bağlam)

`review` alt ajanı kodu yazan konuşmayı görmez — bu doğru. Eksik olan neyi
inceleyeceğiydi. Artık başlatılırken bu oturumdaki değişikliklerin dosya
listesi + diff'i hazır bağlam olarak verilir (~12 KB sınır, sığmayan dosyalar
bildirilir). Ajan diff'i keşfetmek için adım harcamaz.

## 3. Salt-okunur kaçışların kapatılması

`explore`/`review` "salt-okunur" sayılıyordu ama iki kapı açıktı:

| Kaçış | Etki |
|---|---|
| `patch` araç listesinde engellenmiyordu | İnceleme ajanı dosya yazabiliyordu |
| `execute` (Code Mode) içinden `tools.write_file(...)` | Üst düzey filtre görmediği için yazma serbestti |

İkisi de kapatıldı ve test edildi (`scripts/readonly-tools-test.ts`). Bu, kapının
kendisini kuran değişikliğin ön koşuluydu: "salt-okunur" etiketi artık kodla
doğru.

## 4. Ana ajana yansıma

`spawn_agent` sonucu artık `[DOĞRULAMA ✓]` veya `[DOĞRULAMA BAŞARISIZ]`
etiketini taşır; ana ajanın istemi bu etikete göre davranmayı söyler
(başarısızsa "tamamlandı" deme, `task_continue` ile düzelttir).

## Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `EVREN_VERIFY_GATE` | `auto` | `off` ile kapı kapatılır |
| `EVREN_VERIFY_TIMEOUT_MS` | `180000` | Kapı komut zaman aşımı |

## Dosyalar

- `src/main/agent/verifyGate.ts` (yeni) — kapı mantığı, rapor biçimi, düzeltme istemi
- `src/main/agent/reviewBrief.ts` (yeni) — diff brief'i
- `src/main/agent/subagent.ts` — kapı entegrasyonu, review brief enjeksiyonu
- `src/main/agent/loop.ts` — sonuç etiketleri, istem kuralları
- `src/main/agent/tools.ts` — salt-okunur kaçışları kapatıldı (`patch`, `execute`)
- `src/main/agent/taskManager.ts`, `src/shared/types.ts` — `verified`/`verifySummary`
- `src/main/checks.ts` — kontrol zaman aşımı parametresi
- `src/main/agent/subagentLog.ts` — `verify` aşaması
- `scripts/verify-gate-test.ts`, `scripts/verify-gate-e2e-test.ts`,
  `scripts/verify-gate-live-test.ts`, `scripts/readonly-tools-test.ts`,
  `scripts/review-brief-test.ts` (yeni testler)
- `docs/VERIFICATION-GATE.md` (yeni) — tasarım ve sınırlar

## Kanıt

| Test | Sonuç |
|---|---|
| `verify-gate-test` (saf + gerçek npm) | 45/45 |
| `verify-gate-e2e-test` (sahte sunucu) | 27/27 |
| `readonly-tools-test` (kaçışlar) | 23/23 |
| `review-brief-test` | 17/17 |
| `verify-gate-live-test` (**gerçek model**) | 11/11 |

Canlı koşuda düzeltilemeyen test: model iki tur düzeltmeye çalıştı, kapı yine
`BAŞARISIZ` verdi ve `verified=false` kaldı (108 sn). Düzeltilebilir hatada
(`sum`) model kaynağı düzeltti, testi değiştirmedi, `verified=true`.

Tam paket: **81 paket · 1998 kontrol** ✓ · typecheck ✓ · build ✓ · e2e ✓.

## Sınırlar

- Ana ajan döngüsü henüz kapıya tabi değil (sonraki adım).
- Otomatik algılama yalnızca Node/npm projelerinde.
- Kapı "testler geçti" der; "görev doğru yapıldı" demez. Test kapsamı zayıfsa
  bunu bilemez — bu yüzden `review` katmanı ayrı duruyor.
