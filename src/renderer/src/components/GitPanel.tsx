import { useCallback, useEffect, useState } from 'react'
import type {
  GitFile,
  GitGhStatus,
  GitPrStatus,
  GitRemote,
  GitStatus,
  GitWorktree
} from '@shared/types'
import { api } from '../lib/ipc'
import { DiffView } from './DiffView'

interface Props {
  workspacePath: string | null
  refreshKey: number
  onClose: () => void
  onChanged: () => void
}

function statusLabel(file: GitFile): string {
  if (file.untracked) return 'yeni'
  const index = file.indexStatus.trim()
  const worktree = file.worktreeStatus.trim()
  if (index === 'M' || worktree === 'M') return 'değişti'
  if (index === 'A') return 'eklendi'
  if (index === 'D' || worktree === 'D') return 'silindi'
  if (index === 'R') return 'taşındı'
  return 'değişti'
}

function statusLetter(file: GitFile): string {
  if (file.untracked) return '?'
  return (file.indexStatus !== ' ' ? file.indexStatus : file.worktreeStatus).trim() || 'M'
}

export function GitPanel({
  workspacePath,
  refreshKey,
  onClose,
  onChanged
}: Props): React.JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [remotes, setRemotes] = useState<GitRemote[]>([])
  const [gh, setGh] = useState<GitGhStatus | null>(null)
  const [pr, setPr] = useState<GitPrStatus | null>(null)
  const [selected, setSelected] = useState<GitFile | null>(null)
  const [diff, setDiff] = useState('')
  const [diffStaged, setDiffStaged] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!workspacePath) {
      setStatus(null)
      setWorktrees([])
      setBranches([])
      return
    }
    setLoading(true)
    setError(null)
    const [statusResult, worktreeResult, branchResult, remoteResult, ghResult, prResult] =
      await Promise.all([
        api.git.status(),
        api.git.worktrees(),
        api.git.branches(),
        api.git.remotes(),
        api.git.ghStatus(),
        api.git.prStatus()
      ])
    if (statusResult.ok) setStatus(statusResult.data)
    else setError(statusResult.error)
    if (worktreeResult.ok) setWorktrees(worktreeResult.data)
    if (branchResult.ok) setBranches(branchResult.data)
    if (remoteResult.ok) setRemotes(remoteResult.data)
    if (ghResult.ok) setGh(ghResult.data)
    if (prResult.ok) setPr(prResult.data)
    if (statusResult.ok) {
      setPrTitle((current) =>
        current || (statusResult.data.branch ? `${statusResult.data.branch}: değişiklikler` : '')
      )
    }
    setLoading(false)
  }, [workspacePath])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    setSelected(null)
    setDiff('')
    setCommitMessage('')
    setNotice(null)
  }, [workspacePath])

  const showDiff = useCallback(async (file: GitFile, staged: boolean): Promise<void> => {
    setSelected(file)
    setDiffStaged(staged)
    const result = await api.git.diff(file.path, staged)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDiff(result.data)
  }, [])

  const stage = useCallback(
    async (paths?: string[]): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.git.stage(paths)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setNotice(paths?.length ? `${paths.length} dosya stage edildi.` : 'Tüm değişiklikler stage edildi.')
        setSelected(null)
        setDiff('')
        await load()
      } finally {
        setBusy(false)
      }
    },
    [load]
  )

  const unstage = useCallback(
    async (paths?: string[]): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.git.unstage(paths)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setNotice('Stage geri alındı.')
        setSelected(null)
        setDiff('')
        await load()
      } finally {
        setBusy(false)
      }
    },
    [load]
  )

  const commit = useCallback(async (): Promise<void> => {
    if (!commitMessage.trim()) return
    setBusy(true)
    setError(null)
    try {
      const settings = await api.settings.get()
      if (settings.ok && settings.data.hooks?.preCommitChecks) {
        const checks = await api.workspace.runChecks()
        if (checks.ok) {
          const failed = checks.data.filter((check) => !check.ok)
          if (failed.length > 0) {
            setError(
              `Commit öncesi kontroller başarısız: ${failed
                .map((check) => check.label)
                .join(', ')}. Düzeltip tekrar deneyin.`
            )
            return
          }
        }
      }
      const result = await api.git.commit(commitMessage)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCommitMessage('')
      setNotice('Commit oluşturuldu.')
      setSelected(null)
      setDiff('')
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [commitMessage, load, onChanged])

  const createWorktree = useCallback(async (): Promise<void> => {
    if (!newBranch.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.git.worktreeAdd(newBranch)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNewBranch('')
      setNotice(`Worktree: ${result.data.path}`)
      await load()
    } finally {
      setBusy(false)
    }
  }, [load, newBranch])

  const openWorktree = useCallback(
    async (path: string): Promise<void> => {
      const result = await api.workspace.set(path)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onChanged()
      setNotice('Worktree çalışma alanı olarak açıldı.')
    },
    [onChanged]
  )

  const removeWorktree = useCallback(
    async (path: string): Promise<void> => {
      if (!window.confirm('Bu worktree kaldırılsın mı? İçindeki commit edilmemiş değişiklikler kaybolur.')) {
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await api.git.worktreeRemove(path)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setNotice('Worktree kaldırıldı.')
        await load()
      } finally {
        setBusy(false)
      }
    },
    [load]
  )

  const push = useCallback(async (): Promise<void> => {
    if (remotes.length === 0) {
      setError('Tanımlı remote yok. Önce bir origin ekleyin.')
      return
    }
    if (!window.confirm('Mevcut branch remote deposuna push edilsin mi?')) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.git.push()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(`${result.data.branch} → ${result.data.remote} push edildi.`)
      await load()
    } finally {
      setBusy(false)
    }
  }, [load, remotes.length])

  const createPr = useCallback(async (): Promise<void> => {
    if (!prTitle.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.git.prCreate(prTitle, prBody)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice('PR oluşturuldu.')
      await load()
    } finally {
      setBusy(false)
    }
  }, [load, prBody, prTitle])

  const openPr = useCallback(async (url: string): Promise<void> => {
    if (!url) return
    const result = await api.app.openExternal(url)
    if (!result.ok) setError(result.error)
  }, [])

  const saveGhToken = useCallback(async (): Promise<void> => {
    const token = ghToken.trim()
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.github.connect(token)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setGhToken('')
      setNotice('GitHub hesabı bağlandı.')
      await load()
    } finally {
      setBusy(false)
    }
  }, [ghToken, load])

  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0
  const currentPr = pr?.pr ?? null
  const isCurrent = (path: string): boolean =>
    !!workspacePath && path.toLowerCase() === workspacePath.toLowerCase()

  return (
    <aside className="review-pane git-pane">
      <div className="review-head">
        <div>
          <div className="review-title">Git</div>
          <div className="review-meta">
            {status?.isRepo
              ? `${status.branch}${status.ahead ? ` · ${status.ahead} ileri` : ''}${
                  status.behind ? ` · ${status.behind} geri` : ''
                }`
              : 'depo bilgisi yok'}
          </div>
        </div>
        <button className="btn-ghost" onClick={onClose} title="Kapat">
          ✕
        </button>
      </div>

      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      {!workspacePath && (
        <div className="ws-empty-state">
          <p>Git paneli için bir çalışma alanı seçin.</p>
        </div>
      )}

      {workspacePath && loading && <p className="muted ws-empty">Yükleniyor...</p>}

      {workspacePath && !loading && status && !status.isRepo && (
        <div className="ws-empty-state">
          <p>Bu klasör bir Git deposu değil.</p>
          <p className="muted">
            Terminalde <code>git init</code> çalıştırın veya Git destekli bir proje seçin.
          </p>
          <button className="btn-ghost" onClick={() => void load()}>
            Yenile
          </button>
        </div>
      )}

      {workspacePath && !loading && status?.isRepo && (
        <div className="git-body">
          <div className="git-branch-row">
            <span className="git-branch">⎇ {status.branch}</span>
            {remotes.length > 0 ? (
              <span className="git-remote" title={remotes[0].url}>
                → {remotes[0].name}
              </span>
            ) : (
              <span className="git-remote muted">remote yok</span>
            )}
            {status.clean && <span className="git-clean">temiz</span>}
            <div className="git-branch-actions">
              {remotes.length > 0 && (
                <button className="btn-ghost" onClick={() => void push()} disabled={busy}>
                  Push
                </button>
              )}
              <button className="btn-ghost" onClick={() => void stage()} disabled={busy || status.clean}>
                Tümünü stage
              </button>
              <button className="btn-ghost" onClick={() => void unstage()} disabled={busy || stagedCount === 0}>
                Stage geri al
              </button>
            </div>
          </div>

          <div className="git-files">
            <div className="git-section-head">
              Değişiklikler <span>{status.files.length}</span>
            </div>
            {status.files.length === 0 ? (
              <p className="muted ws-empty">Çalışma ağacı temiz.</p>
            ) : (
              status.files.map((file) => (
                <div className={`git-file ${selected?.path === file.path ? 'active' : ''}`} key={file.path}>
                  <button className="git-file-main" onClick={() => void showDiff(file, file.staged)}>
                    <span
                      className={`git-status ${
                        file.untracked
                          ? 'git-untracked'
                          : `git-${statusLetter(file).toLowerCase()}`
                      }`}
                    >
                      {statusLetter(file)}
                    </span>
                    <span className="git-path" title={file.path}>
                      {file.path}
                    </span>
                    <span className="git-state">{file.staged ? 'staged' : statusLabel(file)}</span>
                  </button>
                  {file.staged ? (
                    <button className="git-file-action" onClick={() => void unstage([file.path])} disabled={busy}>
                      Geri al
                    </button>
                  ) : (
                    <button className="git-file-action" onClick={() => void stage([file.path])} disabled={busy}>
                      Stage
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {selected && (
            <div className="git-diff">
              <div className="ws-preview-head">
                <span className="ws-preview-title">
                  {selected.path} {diffStaged ? '(staged)' : ''}
                </span>
                <button className="btn-ghost" onClick={() => setSelected(null)}>
                  Kapat
                </button>
              </div>
              <DiffView diff={diff} />
            </div>
          )}

          <div className="git-commit">
            <input
              className="git-commit-input"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Commit mesajı..."
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commit()
              }}
            />
            <button className="btn" onClick={() => void commit()} disabled={busy || stagedCount === 0 || !commitMessage.trim()}>
              Commit
            </button>
          </div>

          <div className="git-worktrees">
            <div className="git-section-head">
              Worktree'ler <span>{worktrees.length}</span>
            </div>
            {worktrees.map((worktree) => (
              <div className="git-worktree" key={worktree.path}>
                <div className="git-worktree-info">
                  <span className="git-worktree-branch">
                    {worktree.branch} {worktree.isMain && <span className="git-badge">ana</span>}
                  </span>
                  <span className="git-worktree-path" title={worktree.path}>
                    {worktree.path}
                  </span>
                </div>
                <div className="git-worktree-actions">
                  {!isCurrent(worktree.path) && (
                    <button className="git-file-action" onClick={() => void openWorktree(worktree.path)}>
                      Aç
                    </button>
                  )}
                  {!worktree.isMain && (
                    <button className="git-file-action danger" onClick={() => void removeWorktree(worktree.path)}>
                      Kaldır
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="git-worktree-create">
              <input
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                placeholder="Yeni branch adı..."
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createWorktree()
                }}
              />
              <button className="btn-ghost" onClick={() => void createWorktree()} disabled={busy || !newBranch.trim()}>
                Worktree oluştur
              </button>
            </div>
            {branches.length > 0 && (
              <p className="muted git-hint">
                Mevcut branch'ler: {branches.slice(0, 8).join(', ')}
                {branches.length > 8 ? '…' : ''}
              </p>
            )}
          </div>

          <div className="git-pr">
            <div className="git-section-head">Pull Request</div>
            {!gh ? (
              <p className="muted git-hint">GitHub CLI kontrol ediliyor...</p>
            ) : !gh.available ? (
              <p className="muted git-hint">{gh.error ?? 'GitHub CLI (gh) bulunamadı.'}</p>
            ) : !gh.authenticated ? (
              <div className="git-gh-login">
                <p className="muted git-hint">
                  {gh.error ?? 'GitHub CLI oturumu yok.'} Token ile giriş yapabilirsiniz.
                </p>
                <details>
                  <summary>GitHub token ile giriş</summary>
                  <div className="git-gh-token">
                    <input
                      type="password"
                      value={ghToken}
                      onChange={(event) => setGhToken(event.target.value)}
                      placeholder="ghp_... veya github_pat_..."
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="btn-ghost"
                      onClick={() => void saveGhToken()}
                      disabled={busy || !ghToken.trim()}
                    >
                      Kaydet
                    </button>
                  </div>
                  <p className="muted git-hint">
                    Gerekli kapsamlar: <code>repo</code>, <code>workflow</code>,{' '}
                    <code>read:org</code>. Token DPAPI ile yerel saklanır.
                  </p>
                </details>
              </div>
            ) : currentPr ? (
              <div className="git-pr-card">
                <div className="git-pr-head">
                  <span className="git-pr-number">#{currentPr.number}</span>
                  <span className="git-pr-title">{currentPr.title}</span>
                  <span className={`git-pr-state git-pr-${currentPr.state.toLowerCase()}`}>
                    {currentPr.state}
                  </span>
                  <button className="git-file-action" onClick={() => void openPr(currentPr.url)}>
                    GitHub'da aç
                  </button>
                </div>
                {currentPr.checks.length > 0 ? (
                  <ul className="git-checks">
                    {currentPr.checks.map((check, index) => (
                      <li key={`${check.name}-${index}`}>
                        <span className={`git-check-state ${(check.conclusion ?? check.status).toLowerCase()}`}>
                          {check.conclusion === 'SUCCESS'
                            ? '✓'
                            : check.conclusion === 'FAILURE'
                              ? '✗'
                              : '•'}
                        </span>
                        {check.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted git-hint">Check sonucu yok.</p>
                )}
              </div>
            ) : (
              <div className="git-pr-create">
                <input
                  value={prTitle}
                  onChange={(event) => setPrTitle(event.target.value)}
                  placeholder="PR başlığı..."
                />
                <textarea
                  value={prBody}
                  onChange={(event) => setPrBody(event.target.value)}
                  placeholder="Açıklama (opsiyonel)"
                  rows={2}
                />
                <div className="git-pr-actions">
                  <span className="muted git-hint">{pr?.error ?? 'Henüz PR yok.'}</span>
                  <button
                    className="btn-ghost"
                    onClick={() => void createPr()}
                    disabled={busy || !prTitle.trim() || remotes.length === 0}
                  >
                    PR oluştur
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
