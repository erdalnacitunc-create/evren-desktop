# GitHub Hesabı

**Ayarlar > GitHub** sekmesinden GitHub hesabı bağlanabilir. İki yöntem vardır:

1. **Tarayıcı ile giriş (OAuth Device Flow)** — kendi GitHub OAuth App Client
   ID’niz ile.
2. **Personal Access Token (PAT)** — elle token oluşturarak.

Her iki yöntemde de token yalnızca ana süreçte **DPAPI** ile saklanır ve
renderer’a geri verilmez.

## OAuth Device Flow

### OAuth App oluşturma

1. GitHub → **Settings > Developer settings > OAuth Apps > New OAuth App**.
2. Homepage URL: uygulama adresi (ör. `https://github.com/kullanici/evren-desktop`).
3. Authorization callback URL: `http://127.0.0.1` (Device Flow callback kullanmaz).
4. **Enable Device Flow** işaretli olmalı.
5. Oluşan **Client ID**’yi kopyalayın. Client secret gerekmez ve uygulamaya
   girilmemelidir.

### Bağlanma

1. **Ayarlar > GitHub > Tarayıcı ile giriş**.
2. Client ID’yi yapıştırın → **Kodla giriş yap**.
3. Tarayıcı otomatik açılır; ekrandaki `XXXX-XXXX` kodunu girin ve onaylayın.
4. Uygulama kodu arka planda yoklar; onaydan sonra hesap bağlanır.
5. Kod 15 dakika içinde onaylanmazsa süresi dolar; yeni kod oluşturun.

İstenen kapsamlar: `read:user`, `repo`, `read:org`, `workflow`.

## PAT ile bağlama

1. GitHub’da **Settings > Developer settings > Personal access tokens** üzerinden
   token oluşturun.
2. Önerilen kapsamlar:
   - `read:user` — profil
   - `repo` — özel repolar / push / PR
   - `read:org` — organizasyon repoları
   - `workflow` — CI durumu / workflow tetikleme
3. Ayarlar > GitHub > **PAT** > token alanına yapıştırıp **Bağlan**.

Token önce GitHub `/user` ile doğrulanır; geçersizse kaydedilmez.

## Neler yapılabilir?

- Profil: avatar, ad, kullanıcı adı, public/private repo sayısı.
- Token kapsamlarını görme.
- Son güncellenen **repo listesi** (100’e kadar) ve arama.
- Repoyu GitHub’da açma.
- Aynı token; Git panelindeki `gh`/PR/CI ve özel repo uzantı kurulumu tarafından
  kullanılır.
- **Bağlantıyı kes** token’ı siler (Client ID ayarı kalır).

## Güvenlik

- Token yalnızca ana süreçte tutulur; preload/renderer’a dönmez.
- DPAPI (`safeStorage`) ile şifrelenir.
- Client secret kullanılmaz.
- Token URL’lere/loglara yazılmaz.
- Avatar için CSP yalnızca `avatars.githubusercontent.com` kaynağına izin verir.

## Sınırlar

- GitHub App (installation token) henüz yok; OAuth App + Device Flow kullanılıyor.
- Device Flow için kullanıcı kendi OAuth App’ini oluşturmalıdır; uygulama gömülü
  bir Client ID taşımaz.
- Organizasyon SSO’su etkinse token’ın SSO yetkilendirmesi ayrıca yapılmalıdır.


## GitHub App / installation token

Kullanıcı hesabından bağımsız, GitHub App kurulumuna ait kısa ömürlü token.

### GitHub App oluşturma

1. GitHub → **Settings > Developer settings > GitHub Apps > New GitHub App**.
2. **Homepage URL**: uygulama/repo adresi.
3. **Webhook**: kullanmayacaksanız "Active" işaretini kaldırın.
4. İzinler:
   - **Repository permissions > Contents:** Read and write
   - **Pull requests:** Read and write
   - **Actions:** Read and write
   - **Metadata:** Read-only (otomatik)
5. **Where can this GitHub App be installed?** → Any account.
6. **Create GitHub App**.
7. App sayfasından **App ID**'yi kopyalayın.
8. **Private keys > Generate a private key** ile .pem dosyasını indirin.
9. **Install App** ile hesabınıza/organizasyonunuza kurun.

### EVREN Desktop'a bağlama

1. **Ayarlar > GitHub > GitHub App / installation token** bölümünü açın.
2. **App ID** ve .pem private key'i girin (dosya seçici veya yapıştırma).
3. **Kaydet ve kurulumları getir**.
4. Bulunan kurulumlardan birini **Bağla**.
5. Token yaklaşık 1 saat geçerlidir; **Token yenile** veya otomatik yenileme kullanılır.

Private key DPAPI ile saklanır. Installation token diske yazılmaz; yalnızca bellekte
tutulur ve süresi dolunca yeniden üretilir. Git/PR/CI işlemlerinde kullanıcı
token'ından önce denenir.

### Sınırlar

- App, kurulduğu repo/izinlerle sınırlıdır.
- Kurulum token'ı 1 saat geçerlidir; yenileme için App private key gerekir.
- Kurulum seçimi değiştirilirse token yeniden üretilir.
