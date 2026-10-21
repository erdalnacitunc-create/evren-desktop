import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CheckResult,
  CodeIndexStatus,
  CodeSearchResult,
  ProjectCheck,
  RepoMapResult,
  WorkspaceChange,
  WorkspaceEntry,
  WorkspaceFileContent
} from '@shared/types'
import { api } from '../lib/ipc'
import { formatBytes } from '../lib/artifacts'
import { DiffView } from './DiffView'

interface Props {
  workspacePath: string | null
  refreshKey: number
  onChoose: () => void
  onClose: () => void
  onChanged: () => void
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}

function actionLabel(action: WorkspaceChange['action']): string {
  if (action === 'write') return 'yazıldı'
  if (action === 'edit') return 'düzenlendi'
  if (action === 'delete') return 'silindi'
  return 'klasör'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function TreeItem({
  entry,
  depth,
  activePath,
  onOpenFile
}: {
  entry: WorkspaceEntry
  depth: number
  activePath: string | null
  onOpenFile: (entry: WorkspaceEntry) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1)

  if (entry.type === 'dir') {
    return (
      <div className="ws-node">
        <button
          className="ws-node-row ws-dir"
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ws-caret">{open ? '▾' : '▸'}</span>
          <span className="ws-node-icon">📁</span>
          <span className="ws-node-name">{entry.name}</span>
        </button>
        {open &&
          (entry.children ?? []).map((child) => (
            <TreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    )
  }

  return (
    <button
      className={`ws-node-row ws-file ${activePath === entry.path ? 'active' : ''}`}
      style={{ paddingLeft: `${22 + depth * 14}px` }}
      onClick={() => onOpenFile(entry)}
    >
      <span className="ws-node-icon">📄</span>
      <span className="ws-node-name">{entry.name}</span>
      {typeof entry.size === 'number' && (
        <span className="ws-node-size">{formatBytes(entry.size)}</span>
      )}
    </button>
  )
}

export function WorkspacePanel({
  workspacePath,
  refreshKey,
  onChoose,
  onClose,
  onChanged
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<'files' | 'changes' | 'checks' | 'map' | 'search'>('files')
  const [tree, setTree] = useState<WorkspaceEntry[]>([])
  const [changes, setChanges] = useState<WorkspaceChange[]>([])
  const [checks, setChecks] = useState<ProjectCheck[]>([])
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [repoMap, setRepoMap] = useState<RepoMapResult | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [codeIndex, setCodeIndex] = useState<CodeIndexStatus | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CodeSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [checking, setChecking] = useState(false)
  const [file, setFile] = useState<WorkspaceFileContent | null>(null)
  const [selectedChange, setSelectedChange] = useState<WorkspaceChange | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!workspacePath) {
      setTree([])
      setChanges([])
      return
    }
    setLoading(true)
    setError(null)
    const [treeResult, changeResult, checkResult] = await Promise.all([
      api.workspace.tree(),
      api.workspace.changes(40),
      api.workspace.checks()
    ])
    if (treeResult.ok) setTree(treeResult.data)
    else setError(treeResult.error)
    if (changeResult.ok) setChanges(changeResult.data)
    if (checkResult.ok) setChecks(checkResult.data)
    setLoading(false)
  }, [workspacePath])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (tab !== 'map' || !workspacePath) return
    setMapLoading(true)
    void api.workspace
      .repoMap(undefined, 300)
      .then((result) => {
        if (result.ok) setRepoMap(result.data)
        else setError(result.error)
      })
      .finally(() => setMapLoading(false))
  }, [tab, workspacePath, refreshKey])

  useEffect(() => {
    if (tab !== 'search' || !workspacePath) return
    void api.codeIndex.status().then((result) => {
      if (result.ok) setCodeIndex(result.data)
      else setError(result.error)
    })
  }, [tab, workspacePath, refreshKey])

  const selectedFilePath = file?.path ?? null
  useEffect(() => {
    if (!selectedFilePath) return
    void api.workspace.read(selectedFilePath).then((result) => {
      if (result.ok) setFile(result.data)
    })
  }, [refreshKey, selectedFilePath])

  useEffect(() => {
    setFile(null)
    setSelectedChange(null)
    setNotice(null)
  }, [workspacePath])

  const openFile = useCallback(async (entry: WorkspaceEntry): Promise<void> => {
    const result = await api.workspace.read(entry.path)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setFile(result.data)
    setError(null)
  }, [])

  const undo = useCallback(async (): Promise<void> => {
    if (!window.confirm('Son dosya değişikliği adımı geri alınsın mı?')) return
    const checkpoints = await api.workspace.checkpoints(1)
    if (checkpoints.ok && checkpoints.data.length > 0) {
      const result = await api.workspace.restoreCheckpoint(checkpoints.data[0].id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(`${result.data.files} dosya geri alındı.`)
    } else {
      const result = await api.workspace.undo()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(`Geri alındı: ${result.data.path}`)
    }
    setFile(null)
    setSelectedChange(null)
    await load()
    onChanged()
  }, [load, onChanged])

  const choose = useCallback((): void => {
    setError(null)
    onChoose()
  }, [onChoose])

  const runChecks = useCallback(async (names?: string[]): Promise<void> => {
    setChecking(true)
    setError(null)
    try {
      const result = await api.workspace.runChecks(names)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCheckResults(result.data)
    } finally {
      setChecking(false)
    }
  }, [])

  const buildIndex = useCallback(async (): Promise<void> => {
    setIndexing(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.codeIndex.build()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCodeIndex(result.data)
      setSearchResults([])
      setNotice(
        `Kod indeksi hazır: ${result.data.files} dosya, ${result.data.chunks} parça.`
      )
    } finally {
      setIndexing(false)
    }
  }, [])

  const searchIndex = useCallback(async (): Promise<void> => {
    const query = searchQuery.trim()
    if (!query) return
    setSearching(true)
    setError(null)
    try {
      const result = await api.codeIndex.search(query, 8)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSearchResults(result.data)
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const openFolder = useCallback(async (): Promise<void> => {
    const result = await api.workspace.open()
    if (!result.ok) setError(result.error)
  }, [])

  const fileCount = useMemo(() => {
    let count = 0
    const walk = (entries: WorkspaceEntry[]): void => {
      for (const entry of entries) {
        if (entry.type === 'file') count += 1
        if (entry.children) walk(entry.children)
      }
    }
    walk(tree)
    return count
  }, [tree])

  return (
    <aside className="review-pane workspace-pane">
      <div className="review-head">
        <div>
          <div className="review-title">Çalışma Alanı</div>
          <div className="review-meta" title={workspacePath ?? ''}>
            {workspacePath ? basename(workspacePath) : 'klasör seçilmedi'}
          </div>
        </div>
        <button className="btn-ghost" onClick={onClose} title="Kapat">
          ✕
        </button>
      </div>

      <div className="ws-actions">
        <button className="btn-ghost" onClick={choose}>
          {workspacePath ? 'Klasör Değiştir' : 'Klasör Seç'}
        </button>
        <button className="btn-ghost" onClick={() => void load()} disabled={!workspacePath}>
          Yenile
        </button>
        <button className="btn-ghost" onClick={() => void openFolder()} disabled={!workspacePath}>
          Aç
        </button>
        <button
          className="btn-ghost"
          onClick={() => void undo()}
          disabled={!workspacePath || changes.length === 0}
          title="Son dosya değişikliği adımını geri al"
        >
          Geri Al
        </button>
      </div>

      {workspacePath && (
        <div className="ws-path" title={workspacePath}>
          {workspacePath}
        </div>
      )}

      {notice && (
        <div className="ws-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}

      <div className="ws-tabs">
        <button
          className={tab === 'files' ? 'active' : ''}
          onClick={() => setTab('files')}
        >
          Dosyalar <span>{fileCount}</span>
        </button>
        <button
          className={tab === 'changes' ? 'active' : ''}
          onClick={() => setTab('changes')}
        >
          Değişiklikler <span>{changes.length}</span>
        </button>
        <button
          className={tab === 'checks' ? 'active' : ''}
          onClick={() => setTab('checks')}
        >
          Kontroller <span>{checks.length}</span>
        </button>
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
          Harita
        </button>
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
          Ara
        </button>
      </div>

      {!workspacePath && (
        <div className="ws-empty-state">
          <p>Modelin dosya oluşturup düzenleyebilmesi için bir proje klasörü seçin.</p>
          <button className="btn" onClick={choose}>
            Klasör Seç
          </button>
          <p className="muted">
            Dosya araçları yalnızca seçilen klasör içinde çalışır. Her değişiklik yedeklenir
            ve geri alınabilir.
          </p>
        </div>
      )}

      {workspacePath && loading && <p className="muted ws-empty">Yükleniyor...</p>}

      {workspacePath && !loading && tab === 'files' && (
        <div className="ws-files">
          <div className="ws-tree">
            {tree.length === 0 ? (
              <p className="muted ws-empty">Klasör boş veya okunamadı.</p>
            ) : (
              tree.map((entry) => (
                <TreeItem
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  activePath={file?.path ?? null}
                  onOpenFile={(item) => void openFile(item)}
                />
              ))
            )}
          </div>

          {file && (
            <div className="ws-preview">
              <div className="ws-preview-head">
                <span className="ws-preview-title" title={file.path}>
                  {file.path}
                </span>
                <span className="ws-node-size">
                  {formatBytes(file.size)}
                  {file.truncated ? ' · kısaltıldı' : ''}
                </span>
                <button className="btn-ghost" onClick={() => setFile(null)}>
                  Kapat
                </button>
              </div>
              <pre className="ws-file">{file.content}</pre>
            </div>
          )}
        </div>
      )}

      {workspacePath && !loading && tab === 'changes' && (
        <div className="ws-changes">
          {changes.length === 0 ? (
            <p className="muted ws-empty">
              Henüz dosya değişikliği yok. Model dosya yazdığında burada diff görünür.
            </p>
          ) : (
            <div className="ws-change-list">
              {changes.map((change) => (
                <button
                  key={change.id}
                  className={`ws-change ${selectedChange?.id === change.id ? 'active' : ''}`}
                  onClick={() => setSelectedChange(change)}
                >
                  <span className={`ws-change-action ws-${change.action}`}>
                    {actionLabel(change.action)}
                  </span>
                  <span className="ws-change-path" title={change.path}>
                    {change.path}
                  </span>
                  <span className="ws-change-time">{formatTime(change.at)}</span>
                </button>
              ))}
            </div>
          )}

          {selectedChange && (
            <div className="ws-diff-wrap">
              <div className="ws-preview-head">
                <span className="ws-preview-title">{selectedChange.path}</span>
                <button className="btn-ghost" onClick={() => setSelectedChange(null)}>
                  Kapat
                </button>
              </div>
              <DiffView diff={selectedChange.diff} />
            </div>
          )}
        </div>
      )}

      {workspacePath && !loading && tab === 'checks' && (
        <div className="ws-checks">
          <div className="ws-check-head">
            <span>{checks.length} kontrol tanımlı</span>
            <button
              className="btn"
              onClick={() => void runChecks()}
              disabled={checking || checks.length === 0}
            >
              {checking ? 'Çalışıyor...' : 'Tümünü çalıştır'}
            </button>
          </div>

          {checks.length === 0 ? (
            <p className="muted ws-empty">
              package.json içinde typecheck / lint / test scripti bulunamadı.
            </p>
          ) : (
            <div className="ws-check-list">
              {checks.map((check) => (
                <div className="ws-check" key={check.id}>
                  <div className="ws-check-info">
                    <strong>{check.label}</strong>
                    <code>{check.command}</code>
                  </div>
                  <button
                    className="btn-ghost"
                    onClick={() => void runChecks([check.id])}
                    disabled={checking}
                  >
                    Çalıştır
                  </button>
                </div>
              ))}
            </div>
          )}

          {checkResults.length > 0 && (
            <div className="ws-check-results">
              {checkResults.map((result) => (
                <details
                  key={`${result.id}-${result.exitCode}-${result.output.length}`}
                  className={`ws-check-result ${result.ok ? 'ok' : 'fail'}`}
                >
                  <summary>
                    <span className="ws-check-status">{result.ok ? '✓' : '✗'}</span>
                    <span>{result.label}</span>
                    <span className="ws-check-exit">çıkış {result.exitCode}</span>
                  </summary>
                  <pre className="ws-check-output">{result.output}</pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {workspacePath && !loading && tab === 'map' && (
        <div className="ws-map">
          <div className="ws-check-head">
            <span>
              {repoMap
                ? `${repoMap.fileCount} dosya · ${repoMap.symbolCount} sembol`
                : 'Kod haritası'}
            </span>
            <button
              className="btn-ghost"
              onClick={() => {
                setMapLoading(true)
                void api.workspace
                  .repoMap(undefined, 300)
                  .then((result) => {
                    if (result.ok) setRepoMap(result.data)
                    else setError(result.error)
                  })
                  .finally(() => setMapLoading(false))
              }}
              disabled={mapLoading}
            >
              Yenile
            </button>
          </div>
          {mapLoading ? (
            <p className="muted ws-empty">Harita çıkarılıyor...</p>
          ) : (
            <pre className="ws-repo-map">{repoMap?.text ?? 'Harita yok.'}</pre>
          )}
        </div>
      )}

      {workspacePath && !loading && tab === 'search' && (
        <div className="ws-search">
          <div className="ws-check-head">
            <span>
              {codeIndex?.indexed
                ? `${codeIndex.files} dosya · ${codeIndex.chunks} parça`
                : 'Anlamsal indeks yok'}
            </span>
            <button className="btn" onClick={() => void buildIndex()} disabled={indexing}>
              {indexing ? 'İndeksleniyor...' : 'İndeks oluştur'}
            </button>
          </div>
          <p className="ws-search-warning">
            İndeksleme sırasında kaynak kod parçaları embedding için EVREN API'ye gönderilir.
          </p>
          <div className="ws-search-box">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Kodda ara: örn. kimlik doğrulama akışı"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchIndex()
              }}
            />
            <button
              className="btn-ghost"
              onClick={() => void searchIndex()}
              disabled={!codeIndex?.indexed || searching || !searchQuery.trim()}
            >
              {searching ? 'Aranıyor...' : 'Ara'}
            </button>
          </div>
          <div className="ws-search-results">
            {searchResults.map((result, index) => (
              <div
                className="ws-search-result"
                key={`${result.path}:${result.startLine}:${index}`}
              >
                <div className="ws-search-result-head">
                  <span>
                    {result.path}:{result.startLine}-{result.endLine}
                  </span>
                  <span>{result.score.toFixed(3)}</span>
                </div>
                <pre>{result.preview}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
