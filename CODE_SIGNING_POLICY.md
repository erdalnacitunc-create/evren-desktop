# Code signing policy

EVREN Desktop is an open-source Windows and Linux desktop client for the EVREN
LLM API.

**Status:** The SignPath Foundation application was **not approved** in October
2026. The program requires a level of public visibility and independent
recognition that this project has not yet established. Windows releases are
currently **unsigned**. The project may reapply after broader adoption or use a
commercial code-signing certificate.

## Code signing

Code signing is **not currently available** for EVREN Desktop releases.

If signing is added in the future, only artifacts built by GitHub Actions from
this repository will be submitted for signing. The signing private key will be
held by the signing provider (for example, an HSM); this project does not store
or distribute a code-signing private key.

The following Windows artifacts are intended to be signed:

- `EVREN-Desktop-Setup-<version>-x64.exe` (NSIS installer)
- `EVREN Desktop.exe` inside the portable Windows package

Linux artifacts (`.deb` and AppImage) are currently distributed without
Authenticode signing. Their integrity is documented with SHA-256 checksums on
the release page.

## Build and release process

- Source: <https://github.com/erdalnacitunc-create/evren-desktop>
- Windows builds: GitHub Actions, `.github/workflows/windows-sign.yml`
- Linux builds: GitHub Actions, `.github/workflows/linux-build.yml`
- Signing requests: submitted from CI; release signing requires manual
  approval.
- Releases: <https://github.com/erdalnacitunc-create/evren-desktop/releases>

## Team roles

This is currently a single-maintainer project (bus factor: one).

- **Authors / committers:** Erdal Naci Tunc
  ([@erdalnacitunc-create](https://github.com/erdalnacitunc-create))
- **Reviewers:** Erdal Naci Tunc. External pull requests are reviewed before
  merge.
- **Approvers:** Erdal Naci Tunc. Every release signing request is approved
  manually.

Multi-factor authentication is enabled for the GitHub and SignPath accounts.

## Privacy

EVREN Desktop does not collect telemetry, analytics, or advertising data.
See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Verification

Release assets include `SHA256SUMS-<version>.txt`. Users should download
artifacts only from the official GitHub Releases page and verify the checksum
before installation.

## Contact

Erdal Naci Tunc — <erdalnacitunc@gmail.com>

## Changes

This policy may be updated as the project adds maintainers, signing
infrastructure, or release channels. The current version is always available
in this repository.
