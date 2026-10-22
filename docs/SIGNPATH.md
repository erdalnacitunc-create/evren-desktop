# SignPath Foundation ile Windows İmzalama

EVREN Desktop Windows installer'ı SignPath Foundation üzerinden Authenticode ile
imzalanacaktır. SignPath, açık kaynak projelere ücretsiz kod imzalama sağlar;
private key HSM'de tutulur ve GitHub Actions üzerinden imzalama yapılır.

## 1. Başvuru öncesi kontrol

- GitHub reposu **public**: `erdalnacitunc-create/evren-desktop`
- OSI lisansı: **MIT** (`LICENSE`)
- Kaynak kod ve release erişilebilir.
- Proje ticari bir ürün değil, açık kaynak beta.

## 2. SignPath hesabı ve başvuru

1. **https://signpath.org/apply** adresine git.
2. SignPath Foundation başvuru formunu doldur:
   - Proje adı: `EVREN Desktop`
   - Repo: `https://github.com/erdalnacitunc-create/evren-desktop`
   - Lisans: MIT
   - İletişim e-postası
   - Build sistemi: **GitHub Actions**
3. Başvuruyu gönder.
4. Onay e-postasını bekle. Onayda SignPath organizasyon/proje erişimi verilir.

## 3. SignPath proje ayarları

Onaydan sonra:

1. SignPath.io'a giriş yap.
2. **Projects → New project**:
   - Name: `evren-desktop`
   - Repository: GitHub reposu
3. **Artifact configurations**:
   - Windows installer: `release/EVREN-Desktop-Setup-*.exe`
   - Uygulama: `release/win-unpacked/EVREN Desktop.exe`
4. **Signing policy**: Foundation policy / release signing.
5. SignPath GitHub App'i repoya kur ve erişim ver.

## 4. GitHub Actions secrets

SignPath, GitHub Actions'a şu değerleri verir:

- `SIGNPATH_API_TOKEN`
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`

Bunları repo → **Settings → Secrets and variables → Actions** altına ekle.
Token'ı sohbete veya koda yazma.

## 5. İmzalama akışı

1. GitHub Actions Windows runner'da unsigned installer üretir.
2. Installer SignPath'e artifact olarak gönderilir.
3. SignPath imzalar ve imzalı artifact'ı geri verir.
4. Release'e yalnızca **imzalı** installer yüklenir.
5. `Get-AuthenticodeSignature` ile `Status: Valid` doğrulanır.
6. `latest.yml` de release asset olarak yüklenir (auto-update için).
7. Windows publisher adı `package.json` içindeki `win.publisherName` alanına
   SignPath sertifika subject'i olarak eklenir.

## 6. Doğrulama

```powershell
Get-AuthenticodeSignature "release\EVREN-Desktop-Setup-0.2.0-x64.exe" |
  Format-List Status, StatusMessage, SignerCertificate
```

Beklenen:

- `Status : Valid`
- `SignerCertificate.Subject` SignPath/Founder sertifikası
- Zaman damgası mevcut

## 7. Linux

SignPath Windows Authenticode içindir. Linux `.deb`/AppImage için ayrıca
`SHA256SUMS.txt` ve ileride GPG/cosign imzası kullanılır; ayrıntılar
`docs/PARDUS.md`.

## Güvenlik notları

- SignPath private key'i HSM'de tutar; repoya anahtar girmez.
- İmzalı artifact byte'ları değiştiği için sürüm numarası artırılır.
- İmzasız artifact'ı imzalı diye yayınlamayız.
- Release yalnızca resmi GitHub release üzerinden dağıtılır.
