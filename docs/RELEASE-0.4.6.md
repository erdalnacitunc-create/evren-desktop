# 0.4.6 Beta — ajan katmanı: limit, devretme, skill kataloğu

Hibrit mimarinin ilk üç aşaması. Çoklu Evren'e **dokunulmadı** (ayrı konuşma).

## 1. Alt ajan limiti: 6 + 6

0.4.5'e kadar alt ajan sayısı **sınırsızdı**. Model `spawn_agent`'ı kaç kez
çağırırsa o kadar koşu başlıyordu.

| Sınır | Değer | Davranış |
|---|---|---|
| Eşzamanlı | **6** | Kapasite dolunca yeni istek **kuyruğa** girer (FIFO) |
| İstek başına toplam | **6** | Aşılırsa **reddedilir** (bütçe, kuyruk değil) |
| Kuyruk zaman aşımı | 5 dk | Aşılırsa slot bütçeden geri verilir |
| Derinlik | 1 | Alt ajan alt ajan açamaz |

**Kuyruk ile bütçe neden ayrı:** bütçe aşımı modelin planlama hatasıdır
(sonsuz fan-out); kuyruk yalnızca zamanlama sorunudur. İkisini aynı şekilde
reddetmek, meşru paralel işi de cezalandırırdı.

Reddedilen istek modele açıklamayla döner:

```
İstek başına alt ajan bütçesi doldu. (kullanılan: 6/6, etkin: 2/6)
Elindeki sonuçlarla devam et; yeni alt ajan açma.
```

Yani model yeniden denemez, elindekiyle sentez yapar.

### Yinelenen görev koruması

Aynı görev iki kez başlatılamaz. Ancak düz metin benzerliği **yetmedi**:
modeller görevleri şablonla yazıyor ("X ile ilgili tüm dosyaları bul…"),
yalnızca `X` değişiyor. Düz Jaccard bunları %70+ benzer görüp reddediyordu —
canlı testte 8 istekten yalnızca **1** alt ajan çalıştı.

Çözüm **IDF ağırlıklı benzerlik**: şablon sözcükleri ("ilgili", "dosyaları",
"listele") düşük ağırlık alır, ayırt edici sözcük ("faturalama", "arama")
yüksek. Böylece şablon ortaklığı benzerliği şişirmez, gerçek tekrar yakalanır.

## 2. Alt ajanlar seçili modelde ve fiilen devrede

- Alt ajanlar **seçili model** üzerinden koşar (`payload.model`). Ayrı model
  seçimi yoktur; kullanıcı modeli değiştirirse alt ajanlar da değişir.
  Bu bir testle sabitlendi.
- **Asıl sorun kullanımdı:** 15 oturumda `spawn_agent` çağrısı **0**. Sistem
  istemi "karmaşık işleri devret" diyordu ama ne zaman/nasıl olduğunu
  söylemiyordu.

Sistem istemine açık devretme kuralları eklendi (Anthropic'in *"scale effort to
query complexity"* ilkesi):

| Durum | Kural |
|---|---|
| Çok dosyalı keşif ("nerede tanımlı", "tüm çağrı yerleri") | 2-4 `explore`, **paralel** |
| Kod incelemesi / risk taraması | `review` |
| Bağımsız çok adımlı uygulama | `general` |
| Tek dosya / tek komut / bilinen yer | **devretme** |
| Görev metni | hedef + dosya kalıbı + beklenen çıktı (belirsiz görev yasak) |

Ayrıca: "alt ajan sonucu bir **gözlem**dir; çelişki varsa aracı kendin
doğrula" — Cognition'ın örtük karar riskine karşı.

## 3. Skill kataloğu ve yönlendirici

Önce: tüm skill'lerin ad + açıklaması sistem istemine yazılıyor, üstelik
`skill` aracının açıklaması **aynı adları ikinci kez** tekrarlıyordu.

Şimdi:

| Katman | İçerik | Bütçe |
|---|---|---|
| Katalog (bağlamda) | ad + kısa açıklama + "ne zaman" | 6 000 token |
| Gövde (istek üzerine) | tam talimat | 4 000 token, aşılırsa kırpılır + not |

- Bütçe aşılırsa katalog kesilir ve modele **kaç becerinin listelenmediği**
  söylenir (sessiz kesme yok).
- **Yönlendirici**: görev metnine göre en uygun **3** skill işaretlenir
  ("bu göreve uygun"). Gövde yine otomatik yüklenmez; model `skill` aracıyla
  karar verir.
- Türkçe normalizasyon (büyük/küçük harf, `ı/ş/ğ/ü/ö/ç`) ve basit gövde kesme.
- Alt ajanlar da artık katalog alıyor (önceden hiç skill bilgisi yoktu).
- `skill` aracı gövdeyi 4 000 token'da kırpar; kırpıldığını modele söyler.

**Bulunan hata:** yönlendirici `usb`, `git`, `ipc` gibi **kısa ama kritik**
terimleri uzunluk filtresine takıp atıyordu → "usb aygıtlarını incele" sorgusu
0 sonuç döndürüyordu. Eşik 2 karaktere indirildi, yalnızca gerçek dolgu
sözcükleri (ve, ile, bir, için…) eleniyor.

## Doğrulama

| Paket | Kontrol | Kapsam |
|---|---|---|
| `agent-subagent-limit-test` | 42 | Kuyruk, bütçe, iptal, zaman aşımı, FIFO, reset |
| `agent-skill-catalog-test` | 46 | Bütçe, vurgulama, puanlama, Türkçe, kırpma |
| `agent-subagent-e2e-test` | 11 | Gerçek döngü: 8 spawn → 6 çalışır, 2 reddedilir |
| `agent-topology-test` | 54 | Şablonlu ama farklı görevler artık reddedilmiyor |

Toplam: **53 paket / 1224 kontrol** (önceki: 50/1125). typecheck ✓ build ✓ e2e ✓

## Bilinçli olarak yapılmayanlar

- **Çoklu Evren entegrasyonu** — sizin isteğinizle sonraya bırakıldı.
  `planTopology()` hazır ama döngüye bağlanmadı.
- **Otomatik skill taslağı** — onay akışı ve karantina ile birlikte, sonraki
  aşama.
- **Triage'ın döngüye bağlanması** — önce alt ajan kullanımının gerçek
  verisini görmek gerekiyor.

## Sıradaki adım (ölçüm)

0.4.6'yı kurup birkaç çok dosyalı sorgu çalıştırın. Loglarda şunları
görmelisiniz:

```text
(agent/loop) Alt ajan reddedildi: … bütçesi doldu
(agent/loop) Skill kataloğu bütçeye kısıldı: N dahil, M dışarıda
```

Ve olay günlüğünde ilk kez `spawn_agent` çağrıları. Bu veri gelmeden triage
eşiklerini kalibre etmek anlamsız.
