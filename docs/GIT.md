# Git Paneli ve Worktree

EVREN Desktop, çalışma alanı bir Git deposuysa sağdaki **Git** panelini kullanır.
Panel; durum, diff, stage/commit ve izole worktree yönetimi sunar.

## Panel

- **Branch:** mevcut branch, upstream varsa ileri/geri sayısı.
- **Değişiklikler:** `M / A / D / R / ?` durum harfleri, dosya yolu, staged bilgisi.
- **Diff:** dosyaya tıklayınca unified diff; staged diff’te `--cached`.
- **Stage:** tek dosya veya tümü; **Stage geri al**.
- **Commit:** mesaj girip `Commit`; staged değişiklik yoksa düğme kapalıdır.
- **Worktree’ler:** mevcut worktree’ler, ana worktree rozeti, branch ve yol.
  - **Aç:** worktree’yi çalışma alanı olarak açar (oturum izole kopyada devam eder).
  - **Kaldır:** ana worktree hariç; onay ister.
  - **Worktree oluştur:** branch adı verilir; yeni branch yoksa `HEAD`’den oluşturulur.
- **Remote / Push:** `origin` algılanır; **Push** düğmesi `git push -u <remote> <branch>`
  çalıştırır. Remote yoksa düğme gizlenir.
- **Pull Request / CI:** GitHub CLI (`gh`) kurulu ve `gh auth login` yapılmışsa
  PR oluşturma, PR durumu ve check sonuçları gösterilir. `gh` yoksa panel kurulum
  bağlantısı/ihtiyacı gösterir.
  - EVREN Desktop, yönetici gerektirmeyen taşınabilir `gh`’yi
    `%APPDATA%\evren-desktop\bin\gh.exe` altında otomatik arar.
  - Git panelindeki **GitHub token ile giriş** alanına `repo`, `workflow`,
    `read:org` kapsamlı bir token girilebilir; token DPAPI ile saklanır ve `gh`
    komutlarına `GH_TOKEN` olarak verilir.

## Ajan aracı

`git` aracı şu action’ları destekler:

```
status, diff, stage, unstage, commit,
branches, remotes, push, pr_status, pr_create,
worktree_list, worktree_add, worktree_remove
```

- `stage` / `unstage` için `paths` dizisi; boşsa tümü.
- `diff` için `path`, `staged`.
- `commit` için `message`.
- `push` için `remote` (varsayılan `origin`).
- `pr_create` için `title`, `body`.
- `worktree_add` için `branch`.
- `worktree_remove` için `path`.

Araç `execute` kategorisindedir; Plan modunda kapalıdır, Onaylı modda onay ister.

## Güvenlik / sınırlar

- Git komutları `execFile` ile argüman dizisi olarak çalıştırılır; shell
  interpolasyonu yoktur.
- Worktree’ler depo kardeşinde `<repo>-worktrees/<branch>` altında oluşturulur.
- Ana worktree kaldırılamaz.
- Worktree kaldırma `--force` kullanır; commit edilmemiş değişiklikler kaybolur,
  bu yüzden UI onay ister.
- Push için remote tanımlı ve yetkili olmalı.
- PR/CI özellikleri **GitHub CLI (`gh`)** gerektirir; `gh auth login` yapılmamışsa
  panel yalnızca kurulum/oturum mesajı gösterir.
