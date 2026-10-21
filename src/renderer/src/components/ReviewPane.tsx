import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/ipc'
import { formatBytes, type Artifact } from '../lib/artifacts'

interface Props {
  artifact: Artifact
  onClose: () => void
}

type PreviewKind = 'markdown' | 'html' | 'mermaid' | 'table' | 'svg' | 'pdf' | 'none'

function previewKindFor(artifact: Artifact): PreviewKind {
  const language = artifact.language.toLowerCase()
  const content = artifact.content.trim()
  if (language === 'md' || language === 'markdown') return 'markdown'
  if (language === 'html' || language === 'htm') return 'html'
  if (language === 'mermaid' || language === 'mmd') return 'mermaid'
  if (language === 'csv' || language === 'tsv') return 'table'
  if (language === 'svg' || content.startsWith('<svg')) return 'svg'
  if (language === 'pdf') return 'pdf'
  return 'none'
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0))
}

function TablePreview({ content, language }: { content: string; language: string }): React.JSX.Element {
  const rows = useMemo(() => {
    const delimiter =
      language.toLowerCase() === 'tsv'
        ? '\t'
        : (content.split('\n')[0]?.split('\t').length ?? 0) >
            (content.split('\n')[0]?.split(',').length ?? 0)
          ? '\t'
          : ','
    return parseDelimited(content, delimiter)
  }, [content, language])
  const visibleRows = rows.slice(0, 200)
  const columns = Math.max(...visibleRows.map((row) => row.length), 0)
  const maxColumns = Math.min(columns, 30)

  if (rows.length === 0) return <p className="muted">Tabloda satır yok.</p>

  return (
    <div className="csv-preview">
      <table>
        <thead>
          <tr>
            {Array.from({ length: maxColumns }, (_, index) => (
              <th key={index}>{visibleRows[0]?.[index] ?? ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.slice(1).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: maxColumns }, (_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(rows.length > 200 || columns > maxColumns) && (
        <p className="review-preview-note">
          Önizleme kısaltıldı: {Math.min(rows.length, 200)} satır, {maxColumns} sütun.
        </p>
      )}
    </div>
  )
}

function MermaidPreview({ content }: { content: string }): React.JSX.Element {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark')

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.dataset.theme ?? 'dark')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setSvg('')
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'light' ? 'default' : 'dark'
        })
        const id = `mermaid-${Math.random().toString(36).slice(2)}`
        const result = await mermaid.render(id, content)
        if (!cancelled) setSvg(result.svg)
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [content, theme])

  if (error) {
    return <p className="error">Mermaid hatası: {error}</p>
  }
  if (!svg) return <p className="muted">Diyagram oluşturuluyor...</p>
  return <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
}

export function ReviewPane({ artifact, onClose }: Props): React.JSX.Element {
  const [toast, setToast] = useState<string | null>(null)
  const previewKind = previewKindFor(artifact)
  const [view, setView] = useState<'preview' | 'source'>(
    previewKind === 'none' ? 'source' : 'preview'
  )

  useEffect(() => {
    setView(previewKind === 'none' ? 'source' : 'preview')
  }, [artifact.id, previewKind])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(artifact.content)
      setToast('Kopyalandı')
      setTimeout(() => setToast(null), 1500)
    } catch {
      setToast('Kopyalanamadı')
    }
  }

  async function save(): Promise<void> {
    const result = await api.artifacts.save(artifact.title, artifact.content)
    if (result.ok && result.data) {
      setToast('Kaydedildi')
      setTimeout(() => setToast(null), 1500)
    } else if (!result.ok) {
      setToast(result.error)
      setTimeout(() => setToast(null), 2000)
    }
  }

  async function saveAndOpen(): Promise<void> {
    const result = await api.artifacts.save(artifact.title, artifact.content)
    if (!result.ok) {
      setToast(result.error)
      return
    }
    if (!result.data) return
    const opened = await api.app.openPath(result.data)
    if (!opened.ok) setToast(opened.error)
  }

  const previewable = previewKind !== 'none'

  return (
    <aside className="review-pane">
      <div className="review-head">
        <div className="review-head-info">
          <strong>{artifact.title}</strong>
          <span className="review-meta">
            {formatBytes(artifact.bytes)}
            {artifact.language ? ` · ${artifact.language}` : ' · metin'}
          </span>
        </div>
        <div className="review-actions">
          {previewable && (
            <div className="review-view-toggle">
              <button
                className={view === 'preview' ? 'active' : ''}
                onClick={() => setView('preview')}
              >
                Önizleme
              </button>
              <button
                className={view === 'source' ? 'active' : ''}
                onClick={() => setView('source')}
              >
                Kaynak
              </button>
            </div>
          )}
          <button className="btn-ghost" onClick={() => void copy()}>
            Kopyala
          </button>
          <button className="btn-ghost" onClick={() => void save()}>
            Kaydet
          </button>
          {previewKind === 'pdf' && (
            <button className="btn-ghost" onClick={() => void saveAndOpen()}>
              Kaydet ve aç
            </button>
          )}
          <button className="btn-ghost" onClick={onClose} title="İncelemeyi kapat">
            ✕
          </button>
        </div>
      </div>

      <div className={`review-body ${view === 'preview' ? 'review-body-preview' : ''}`}>
        {view === 'source' || !previewable ? (
          <pre className="review-code">
            <code>{artifact.content}</code>
          </pre>
        ) : previewKind === 'markdown' ? (
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
          </div>
        ) : previewKind === 'html' ? (
          <div className="html-preview-wrap">
            <p className="review-preview-note">
              HTML önizleme sandbox içinde; script’ler ve formlar kapalıdır.
            </p>
            <iframe
              className="html-preview"
              sandbox=""
              title={`${artifact.title} önizleme`}
              srcDoc={artifact.content}
            />
          </div>
        ) : previewKind === 'mermaid' ? (
          <MermaidPreview content={artifact.content} />
        ) : previewKind === 'table' ? (
          <TablePreview content={artifact.content} language={artifact.language} />
        ) : previewKind === 'svg' ? (
          <div className="svg-preview">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.content)}`}
              alt={`${artifact.title} önizleme`}
            />
          </div>
        ) : (
          <div className="review-preview-note">
            PDF içeriği gömülü önizlenemiyor. <strong>Kaydet</strong> ile dışa aktarıp
            sistem görüntüleyicisinde açabilirsiniz.
          </div>
        )}
      </div>

      {toast && <div className="review-toast">{toast}</div>}
    </aside>
  )
}
