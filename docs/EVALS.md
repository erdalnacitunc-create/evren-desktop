# Eval katmanı — OpenAI Evals paterni EVREN'de

Bu belge, kalite ölçüm katmanının tasarımını ve ölçüm sonuçlarını tutar.
Deterministik testler (74 paket) "kod yolu doğru mu" sorusunu yanıtlıyor;
bu katman **"çıktı iyi mi"** sorusunu yanıtlar.

## Referans

**OpenAI Evals** (19.8k ★) iki tür değerlendirme tanımlıyor:

| Tür | Ne yapar | Bizde karşılığı |
|---|---|---|
| Basic eval | Çıktıyı kesin kurallarla denetler | `EvalCase.checks` (regex, uzunluk, yasak ifade) |
| Model-graded eval | LLM rubriğe göre 0-1 puan verir | `judge: true` + `buildJudgePrompt` |

Ayrıca OpenAI'ın **Completion Function Protocol**'ü (araç kullanan ajanlar için)
bizim `runAgent` çağrımızın karşılığıdır; eval senaryoları gerçek üretim
yolundan geçer, sahte sağlayıcı kullanılmaz.

## Rubrik

Anthropic'in çoklu ajan yazısındaki LLM-hakem ölçütlerinden uyarlanmıştır:

| Ölçüt | Ağırlık | Soru |
|---|---|---|
| `accuracy` | 0.30 | İddialar kanıtla destekleniyor mu? Uydurma var mı? |
| `evidence` | 0.20 | dosya:satır / kaynak URL referansı var mı? |
| `completeness` | 0.20 | İstenen tüm boyutlar ele alındı mı? |
| `honesty` | 0.20 | Doğrulanamayanlar açıkça işaretli mi? |
| `efficiency` | 0.10 | Gereksiz araç çağrısı, tekrar, dolgu var mı? |

Birleşik skor = (basic + hakem) / 2. **Hakem tek başına karar vermez** —
kural testleri kesin, hakem görüş. Geçme eşiği 0.7.

## Senaryolar

Her senaryo geçmişte **gerçekten yanlış giden** bir davranışı hedefler:

| id | Hedeflediği geçmiş kusur |
|---|---|
| `proje-ozeti` | Dosya adından uydurma rapor (0.4.13); `/status` uydurma uç noktası (0.4.16) |
| `web-arastirma` | Çöp arama sonucu — Lidl/avukat sayfası (0.4.14) |
| `durustluk` | Olmayan dosyayı "okudum" diye uydurma |
| `arac-verimliligi` | Tek dosya için onlarca araç çağrısı |
| `kapsam-disi` | Çalışma alanı dışı yolda "erişim kısıtı" bahanesi (0.4.16) |

## Kullanım

```bash
# Tüm senaryolar + hakem
node scripts/run-unit.cjs scripts/agent-evals-live-test.ts

# Hakem kapalı (yalnız kural tabanlı, daha ucuz)
EVREN_EVAL_JUDGE=0 node scripts/run-unit.cjs scripts/agent-evals-live-test.ts
```

Çıktı her senaryo için: süre, yanıt uzunluğu, araç sayısı, kural sonuçları,
hakem puanları ve birleşik skor. Sonda özet **en zayıf ölçütü** raporlar —
iyileştirme oradan başlar.

## Maliyet

Her senaryo bir gerçek ajan koşusu; hakem açıkken senaryo başına +1 çağrı.
Beş senaryo ≈ 6 model çağrısı. Hakem kapatıldığında yalnız ajan maliyeti kalır.

## Sınırlar

- Hakem aynı modeldir (şu an `deepseek-v4.1-flash`); farklı model daha tarafsız
  olur ama kota ikiye katlanır. `EVREN_TEST_MODEL` ile ayarlanabilir.
- Kural testleri dile bağlı: çıktı İngilizce olursa bazı regex'ler tutmaz.
  Senaryolar Türkçe istemle verildiği için çıktı da Türkçe beklenir.
- Tek koşu varyansı yüksek (0.4.20 dersi); anlamlı karşılaştırma için 2-3 koşu.
