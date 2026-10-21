import { useMemo } from 'react'

export function DiffView({ diff }: { diff: string }): React.JSX.Element {
  const lines = useMemo(() => (diff ? diff.split('\n') : []), [diff])
  if (lines.length === 0) {
    return <p className="muted ws-empty">Fark yok.</p>
  }
  return (
    <pre className="ws-diff">
      {lines.map((line, index) => {
        const className =
          line.startsWith('+++') || line.startsWith('---')
            ? 'ws-diff-file'
            : line.startsWith('@@')
              ? 'ws-diff-hunk'
              : line.startsWith('+')
                ? 'ws-diff-add'
                : line.startsWith('-')
                  ? 'ws-diff-del'
                  : 'ws-diff-ctx'
        return (
          <span key={index} className={className}>
            {line || ' '}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}
