# Clean-Room & Yasal İlkeler (EVREN Desktop)

Bu proje **açık kaynak**tır ve **temiz oda (clean-room)** yöntemiyle geliştirilir.
Amaç: EVREN LLM API'siyle birlikte çalışan (interoperable) özgün bir masaüstü
istemcisi üretmek — başka ürünlerin kodunu veya varlıklarını kopyalamadan.

## İlkeler
1. **Kopyalama yok.** Tescilli uygulamalardan (ör. Claude Desktop) yalnızca
   *davranış gözlemi* ve *arayüz deseni* öğrenilir. İkon, metin, çeviri, ses,
   animasyon, kod, şema veya başka varlık KOPYALANMAZ.
2. **Teknik gerçek kaynağı** kamuya açık veridir: EVREN `openapi.json`
   sözleşmesi, resmi dokümanlar ve kendi hesabımızla yaptığımız ağ gözlemi
   (birlikte çalışabilirlik / interoperability hakkı).
3. **Üçüncü taraf açık kaynak** referansları yalnızca ilham ve desen içindir.
   Lisanslarına uyulur:
   - MIT / Apache-2.0 / BSD: atıf korunur, `THIRD_PARTY_NOTICES.md` güncellenir.
   - GPL/AGPL kod: kopyalanmaz (aksi halde bu proje enfekte olur). Yalnızca
     genel fikir/desen düzeyinde yararlanılır.
   Doğrudan kod alınmazsa bile, alınan her dış bağımlılık lisans taramasından geçer.
4. **Dağıtım/yeniden kullanımda kod alıntılama:** Bir açık kaynak projeden anlamlı
   kod parçası alınırsa, dosya başına kaynak + lisans + telif notu eklenir ve
   uyumluluk kontrol edilir. Tercih: kendi implementasyonumuzu yazmak.
5. **Hedef erişimi yetkili olmalı.** Yalnızca sahibi olduğumuz/yetkili olduğumuz
   yazılımlar ve kendi hesabımız analiz edilir. REA `DISCLAIMER.md` politikasına
   uyulur; lisans kırma/atlatma yoktur.
6. **Gizlilik:** API anahtarları yerel ve şifreli saklanır (Windows DPAPI);
   telemetri toplanmaz. EVREN şartlarına (KVKK, kredi/CR) uyulur.

## Bu projenin lisansı
**MIT** — bkz. `LICENSE`. OpenCode ile aynı lisans ailesi (uyumlu yeniden kullanım).

## İzlenebilirlik
- `docs/PLAN.md` — kilometre taşları ve REA görevleri.
- `docs/API-NOTES.md` — kamu API sözleşmesinden çıkarılan notlar.
- `THIRD_PARTY_NOTICES.md` — bağımlılık lisans envanteri.
