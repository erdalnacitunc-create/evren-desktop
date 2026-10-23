# Pardus / Debian Paketleme

EVREN Desktop Linux hedefi **Pardus 25.x** ve uyumlu Debian tabanlı dağıtımlardır.
Pardus, TÜBİTAK tarafından geliştirilen, **Debian tabanlı**, `apt`/`dpkg` kullanan
64-bit bir GNU/Linux dağıtımıdır (Xfce/GNOME/ETAP masaüstleri).

## Paket türleri

| Tür | Dosya | Kullanım |
|---|---|---|
| **.deb (birincil)** | `evren-desktop_<sürüm>_amd64.deb` | Pardus, Debian, Ubuntu |
| **AppImage** | `EVREN Desktop-<sürüm>.AppImage` | Kurulumsuz taşınabilir çalıştırma |

Windows `.exe` ve Linux `.deb` aynı sürüm numarasını kullanır.

## Pardus'a kurulum

```bash
sudo apt install ./evren-desktop_0.2.2_amd64.deb
evren-desktop
```

veya:

```bash
chmod +x "EVREN Desktop-0.2.2.AppImage"
./"EVREN Desktop-0.2.2.AppImage"
```

## Derleme

Linux paketleri **Linux runner üzerinde** üretilir; Windows'ta cross-build
AppImage symlink izinleri nedeniyle güvenilir değildir.

```bash
npm ci
npm run build:linux
```

veya GitHub Actions:

- **Actions → Linux build (Pardus) → Run workflow**

Çıktılar `release/` altında:

- `*.deb`
- `*.AppImage`
- `SHA256SUMS.txt`

## Pardus uyumluluğu

- Electron 44 `linux-x64`; 32-bit Linux hedefi yok.
- Terminal `/bin/bash` kullanır; PowerShell yalnızca Windows'ta.
- **Computer use** Windows/PowerShell yardımcısına bağlıdır; Linux'ta
  kullanılmamalıdır (varsayılan kapalı).
- API anahtarı Linux'ta `safeStorage`/keyring üzerinden saklanır; keyring yoksa
  onboarding uyarı gösterir.
- GitHub CLI varsa `PATH` üzerinden kullanılır; gömülü `gh.exe` yalnızca Windows.
- `.deb` güncellemeleri için paket yöneticisi veya yeni `.deb` kullanılır;
  AppImage otomatik güncelleme akışı ayrıca test edilmelidir.

## İmzalama

Linux'ta Windows Authenticode uygulanmaz. Linux güvenilirliği için:

- `SHA256SUMS.txt` (release asset),
- ileride GPG detached imza (`SHA256SUMS.txt.asc`) veya Sigstore/cosign,
- resmi GitHub release bağlantısı.

Windows installer imzası SignPath Foundation üzerinden yapılır; Linux paketleri
aynı sürüm etiketi altında yayınlanır.
