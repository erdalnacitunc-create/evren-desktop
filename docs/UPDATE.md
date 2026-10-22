# Otomatik Güncelleme

EVREN Desktop, **electron-updater** ve GitHub Releases üzerinden güncelleme
kontrolü yapar.

## Akış

1. Paketlenmiş uygulama açılıştan 15 saniye sonra güncelleme kontrol eder.
2. Ardından 6 saatte bir kontrol eder.
3. **Ayarlar > Genel > Güncellemeler** üzerinden manuel kontrol edilebilir.
4. Yeni sürüm varsa:
   - sürüm notları gösterilir,
   - **Güncellemeyi indir** ile indirilir,
   - **Yeniden başlat ve kur** ile kurulur.

## Release gereksinimleri

- GitHub release `v<semver>` etiketi taşımalıdır.
- Release asset’leri:
  - `EVREN-Desktop-Setup-<sürüm>-x64.exe`
  - `latest.yml`
  - `.blockmap`
- Windows installer **Authenticode ile imzalı** olmalıdır.
- `latest.yml` imzalı installer’a ait `sha512` değerini içerir.

## Güvenlik

- Güncelleme yalnızca HTTPS/GitHub Releases üzerinden indirilir.
- `electron-updater` SHA-512 bütünlük kontrolü yapar.
- SignPath sertifika subject’i, imzalı sürümde `win.publisherName` olarak
  yapılandırılmalıdır; aksi halde yayıncı doğrulaması eksik kalır.
- İmzasız bir installer otomatik güncelleme için yayınlanmaz.
- Geliştirme modunda güncelleme devre dışıdır.
- `EVREN_UPDATE_DISABLE=1` ile acil durumda kapatılabilir.

## Platformlar

- **Windows NSIS:** otomatik güncelleme desteklenir.
- **Linux AppImage:** `latest-linux.yml` ile desteklenebilir; ayrı test gerekir.
- **Linux .deb:** güncelleme paket yöneticisi veya yeni `.deb` ile yapılır.
- **Windows 32-bit:** desteklenmez (Electron 44 ia32 binary’si yok).

## Yayınlama sırası

1. Sürüm numarasını artır.
2. İmzalı installer + `latest.yml` + `.blockmap` üret.
3. GitHub release’e yükle.
4. `latest.yml` dosyasının release’te olduğunu doğrula.
5. Eski bir sürümden güncelleme akışını test et.
