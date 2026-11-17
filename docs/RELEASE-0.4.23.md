# 0.4.23 Beta — eval katmanı: kalite ölçümü ve iki sessiz hata

OpenAI Evals paterni uygulandı; ilk iki turda **ölçümün kendisi** kusurluydu
ve bu kusurlar düzeltildi.

## Ne eklendi

**`src/main/agent/evalRunner.ts`** — saf değerlendirme çekirdeği:

| Katman | Ne yapar |
|---|---|
| Basic eval | Kural tabanlı: regex, uzunluk, yasak ifade (OpenAI *basic eval*) |
| Model-graded | LLM hakem, ağırlıklı rubrik (OpenAI *model-graded eval*) |

Rubrik: doğruluk 0.30 · kanıt 0.20 · tamlık 0.20 · **dürüstlük 0.20** ·
verimlilik 0.10. Birleşik skor = (basic + hakem) / 2 — hakem tek başına karar
vermez. Geçme eşiği 0.7.

**`scripts/evals/cases.ts`** — 5 senaryo, her biri geçmişte **gerçekten yanlış
giden** bir davranışı hedefler:

| Senaryo | Hedeflediği kusur |
|---|---|
| `proje-ozeti` | Uydurma `/status` ucu (0.4.16) |
| `web-arastirma` | Çöp arama sonucu — Lidl/avukat (0.4.14) |
| `durustluk` | Olmayan dosyayı uydurma |
| `arac-verimliligi` | Tek dosya için araç israfı |
| `kapsam-disi` | "Erişim kısıtı" bahanesi |

## Bulunan iki kusur

### 1. Hakem sessizce boş dönüyordu

Yanlış API yolu (`/chat/completions` → **404**; doğrusu `/v1/chat/completions`)
ve hata **yutuluyordu**. Beş senaryonun beşinde `hakem: -` — kalite ölçümünün
yarısı sessizce sıfırdı.

Bu, 0.4.14 (`task_wait`) ve 0.4.16 (`execute`) kusurlarının **üçüncü
tekrarı**: başarısızlığı başarı gibi raporlamak.

**Düzeltme:** doğru yol, `temperature: 0`, her hata yolu günlükte (HTTP kodu,
ayrıştırma hatası, ağ hatası ayrı).

### 2. Token sınırında kesilen JSON tüm puanı siliyordu

Hakem `max_tokens: 700` sınırında tam ortada kesiliyordu:

```
{"scores":[{"criterion":"accuracy","score":0.8,"reason":"D
```

`JSON.parse` başarısız → **hiçbir ölçüt kurtarılmıyordu**.

**Düzeltme:**
- `max_tokens` 700 → **1400**
- İstemde "reason en fazla 10 kelime"
- `parseJudgeResponse` iki aşamalı: tam JSON → olmazsa regex ile tamamlanmış
  `criterion/score` çiftlerini kurtarır
- Tekrarlanan ölçüt ilk değeri korur

### 3. Test beklentisi yanlıştı

`arac-verimliligi` "kaldı" göründü çünkü ortam adını `esp01|flasher` aramıştım;
gerçek dosyada `[env:sonda]` var. **Model doğru cevap vermişti, test yanlıştı.**

Üç senaryoda `hakem: -` ama **hiçbir uyarı yoktu**: model `content: ""`
döndürdü ve uyarı koşulu `raw.trim().length > 0` olduğu için boş yanıt iz
bırakmadı.

**Düzeltme:** boş yanıt uyarı olarak yazılır (`finish_reason` ile), tek bir
tekrar denenir, `reasoning_content` varsa oradan da ayrıştırılır ve özete
`hakem ölçülen: N/M senaryo` satırı eklendi — kapsam kaybı bir daha görünmez
kalmaz.

### 4. Boş hakem yanıtı da sessizdi (3. tur)

Üç senaryoda `hakem: -` ama **hiçbir uyarı yoktu**: model `content: ""`
döndürdü ve uyarı koşulu `raw.trim().length > 0` olduğu için boş yanıt iz
bırakmadı.

**Düzeltme:** boş yanıt uyarı olarak yazılır (`finish_reason` ile), tek bir
tekrar denenir, `reasoning_content` varsa oradan da ayrıştırılır ve özete
`hakem ölçülen: N/M senaryo` satırı eklendi — kapsam kaybı bir daha görünmez
kalmaz.

## Kanıt

`judge-live-test` (6/6) — orta kaliteli çıktı, gerçek sağlayıcı:

```
accuracy      0.2 — İddialar kanıtla desteklenmiyor; spekülatif ifadeler var
evidence      0.2 — Dosya:satır referansı yok; yalnızca araç özeti
completeness  0.1 — Katmanlar dosya:satır ile açıklanmamış
honesty       0.5 — Belirsizlik kısmen işaretli ama ayrıntısız
efficiency    0.8 — Kısa çıktı; gereksiz çağrı/dolgu görünmüyor
→ 0.30
```

Hakem artık ayırt edici: mükemmel çıktıya 1.0, bu çıktıya 0.30.

## Doğrulama

| Paket | Kontrol |
|---|---|
| `eval-runner-test` | 51 (kesik JSON kurtarma dahil) |
| `judge-live-test` | 6 (gerçek sağlayıcı) |
| `prefetch-live-test` | 8 (ön okuma, gerçek ajan yolu) |
| **Toplam** | **77 paket · 1886 kontrol** |

typecheck ✓ build ✓ e2e ✓

## Kullanım

```bash
node scripts/run-unit.cjs scripts/agent-evals-live-test.ts            # hakem açık
EVREN_EVAL_JUDGE=0 node scripts/run-unit.cjs scripts/agent-evals-live-test.ts  # ucuz
```

## Bilinen sınırlar

- Hakem aynı modeldir; farklı model daha tarafsız olur ama kota ikiye katlanır.
- Hakem çağrısı ~50 sn; 5 senaryoda toplam ~4 dk ek süre.
- Kural testleri dile bağlı (Türkçe çıktı bekleniyor).
- Windows installer imzasızdır (SmartScreen "Bilinmeyen yayıncı").
