import { useState } from 'react'
import type { InstalledExtension, McpServerConfig } from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  extension: InstalledExtension
  onClose: () => void
  onSaved: () => void
}

function parseArgs(value: string): string[] {
  return value.trim() ? value.trim().split(/\s+/) : []
}

function parseEnv(value: string): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function parseHeaders(value: string): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf(':')
    if (index < 0) continue
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function formatPairs(value: Record<string, string> | undefined, separator: '=' | ':'): string {
  if (!value) return ''
  return Object.entries(value)
    .map(([key, item]) => `${key}${separator} ${item}`)
    .join('\n')
}

export function McpConfigEditor({ extension, onClose, onSaved }: Props): React.JSX.Element {
  const config = extension.config
  const [type, setType] = useState<'local' | 'remote'>(config?.type ?? 'local')
  const [command, setCommand] = useState(config?.command ?? '')
  const [args, setArgs] = useState((config?.args ?? []).join(' '))
  const [cwd, setCwd] = useState(config?.cwd ?? '')
  const [env, setEnv] = useState(formatPairs(config?.env, '='))
  const [url, setUrl] = useState(config?.url ?? '')
  const [headers, setHeaders] = useState(formatPairs(config?.headers, ':'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function logout(): Promise<void> {
    await api.mcp.logout(extension.id)
    onSaved()
    onClose()
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const next: McpServerConfig =
        type === 'remote'
          ? { type: 'remote', url: url.trim(), headers: parseHeaders(headers) }
          : {
              type: 'local',
              command: command.trim(),
              args: parseArgs(args),
              cwd: cwd.trim() || undefined,
              env: parseEnv(env)
            }

      if (next.type === 'remote' && !next.url) {
        setError('Uzak MCP için URL gerekli.')
        return
      }
      if (next.type === 'local' && !next.command) {
        setError('Yerel MCP için komut gerekli.')
        return
      }

      const result = await api.extensions.updateConfig(extension.id, next)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>MCP yapılandırması</h2>
          <button className="btn-ghost" onClick={onClose}>
            Kapat
          </button>
        </div>

        <div className="modal-body">
          <p className="muted">{extension.name}</p>

          <div className="segmented" style={{ marginBottom: 14 }}>
            <button className={type === 'local' ? 'active' : ''} onClick={() => setType('local')}>
              Yerel (stdio)
            </button>
            <button className={type === 'remote' ? 'active' : ''} onClick={() => setType('remote')}>
              Uzak (HTTP)
            </button>
          </div>

          {type === 'local' ? (
            <>
              <label className="field">
                <span>Komut</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Argümanlar (boşlukla ayrılmış)</span>
                <input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y rea-agents --mcp"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Çalışma dizini (opsiyonel)</span>
                <input
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Ortam değişkenleri (KEY=VALUE, satır başına)</span>
                <textarea
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  rows={3}
                  spellCheck={false}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Sunucu URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Başlıklar (KEY: VALUE, satır başına)</span>
                <textarea
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  rows={3}
                  spellCheck={false}
                />
              </label>
              <p className="params-note">
                OAuth gerekiyorsa Bağlan sırasında tarayıcı otomatik açılır. API anahtarı için
                başlık kullanabilirsiniz.
              </p>            </>
          )}

          {error && <p className="error">{error}</p>}

          <div className="inline-actions">
            {type === 'remote' && (
              <button
                className="btn-ghost danger"
                onClick={() => void logout()}
                disabled={busy}
              >
                OAuth'u sıfırla
              </button>
            )}
            <button className="btn-ghost" onClick={onClose} disabled={busy}>
              Vazgeç
            </button>
            <button className="btn" onClick={() => void save()} disabled={busy}>
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
