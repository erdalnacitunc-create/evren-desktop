import { useCallback, useEffect, useMemo, useState } from 'react'
import type { McpElicitationRequest } from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  request: McpElicitationRequest
  onDone: () => void
}

interface FieldSchema {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  enumNames?: string[]
  oneOf?: Array<{ const: string; title: string }>
  items?: { anyOf?: Array<{ const: string; title: string }> }
  minimum?: number
  maximum?: number
  format?: string
  minLength?: number
  maxLength?: number
}

function fieldOptions(field: FieldSchema): Array<{ value: string; label: string }> {
  if (Array.isArray(field.enum)) {
    return field.enum.map((value, index) => ({
      value,
      label: field.enumNames?.[index] ?? value
    }))
  }
  if (Array.isArray(field.oneOf)) {
    return field.oneOf.map((option) => ({ value: option.const, label: option.title }))
  }
  if (Array.isArray(field.items?.anyOf)) {
    return field.items.anyOf.map((option) => ({ value: option.const, label: option.title }))
  }
  return []
}

export function McpElicitationModal({ request, onDone }: Props): React.JSX.Element {
  const schema = request.schema as
    | { type?: string; properties?: Record<string, FieldSchema>; required?: string[] }
    | undefined
  const fields = useMemo(
    () => Object.entries(schema?.properties ?? {}),
    [schema?.properties]
  )
  const required = useMemo(() => new Set(schema?.required ?? []), [schema?.required])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const initial: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(schema?.properties ?? {})) {
      if (field.default !== undefined) initial[name] = field.default
      else if (field.type === 'boolean') initial[name] = false
      else if (field.type === 'array') initial[name] = []
      else initial[name] = ''
    }
    setValues(initial)
  }, [schema])

  const respond = useCallback(
    async (action: 'accept' | 'decline' | 'cancel'): Promise<void> => {
      setError(null)
      if (action === 'accept' && request.mode === 'form') {
        for (const name of required) {
          const value = values[name]
          if (
            value === undefined ||
            value === null ||
            value === '' ||
            (Array.isArray(value) && value.length === 0)
          ) {
            setError(`"${name}" alanı zorunlu.`)
            return
          }
        }
      }
      setBusy(true)
      try {
        const content: Record<string, unknown> = {}
        for (const [name, value] of Object.entries(values)) {
          const empty =
            value === undefined ||
            value === null ||
            value === '' ||
            (Array.isArray(value) && value.length === 0)
          if (empty && !required.has(name)) continue
          content[name] = value
        }
        const result = await api.mcp.respondElicitation(
          request.id,
          action,
          action === 'accept' && request.mode === 'form' ? content : undefined
        )
        if (!result.ok) {
          setError(result.error)
          return
        }
        onDone()
      } finally {
        setBusy(false)
      }
    },
    [onDone, request.id, request.mode, required, values]
  )

  const openUrl = useCallback(async (): Promise<void> => {
    if (!request.url) return
    const result = await api.app.openExternal(request.url)
    if (!result.ok) setError(result.error)
  }, [request.url])

  return (
    <div className="modal-overlay mcp-elicit-overlay">
      <div
        className="modal modal-narrow mcp-elicit"
        role="dialog"
        aria-modal="true"
        aria-label="MCP onayı"
      >
        <div className="modal-head">
          <div>
            <h2>MCP onayı</h2>
            <span className="muted mcp-elicit-server">{request.serverName}</span>
          </div>
        </div>
        <div className="modal-body">
          <p className="mcp-elicit-message">{request.message}</p>
          {error && <div className="ws-error">{error}</div>}

          {request.mode === 'url' ? (
            <div className="mcp-elicit-url">
              <p className="muted">Sunucu tarayıcıda bir adım tamamlamanızı istiyor.</p>
              {request.url && <code>{request.url}</code>}
              <button className="btn" onClick={() => void openUrl()} disabled={!request.url}>
                Bağlantıyı aç
              </button>
            </div>
          ) : fields.length === 0 ? (
            <p className="muted">Bu istek için form alanı yok.</p>
          ) : (
            <div className="mcp-elicit-fields">
              {fields.map(([name, field]) => {
                const options = fieldOptions(field)
                const value = values[name]
                return (
                  <label className="field" key={name}>
                    <span>
                      {field.title ?? name}
                      {required.has(name) ? ' *' : ''}
                    </span>
                    {field.description && (
                      <small className="muted mcp-elicit-help">{field.description}</small>
                    )}
                    {field.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [name]: event.target.checked
                          }))
                        }
                      />
                    ) : options.length > 0 && field.type === 'array' ? (
                      <select
                        multiple
                        value={Array.isArray(value) ? value.map(String) : []}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [name]: [...event.target.selectedOptions].map(
                              (option) => option.value
                            )
                          }))
                        }
                      >
                        {options.map((option) => (
                          <option value={option.value} key={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : options.length > 0 ? (
                      <select
                        value={String(value ?? '')}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [name]: event.target.value }))
                        }
                      >
                        <option value="">Seçin...</option>
                        {options.map((option) => (
                          <option value={option.value} key={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          field.type === 'number' || field.type === 'integer'
                            ? 'number'
                            : field.format === 'date'
                              ? 'date'
                              : field.format === 'date-time'
                                ? 'datetime-local'
                                : field.format === 'email'
                                  ? 'email'
                                  : field.format === 'uri'
                                    ? 'url'
                                    : 'text'
                        }
                        value={String(value ?? '')}
                        min={field.minimum}
                        max={field.maximum}
                        minLength={field.minLength}
                        maxLength={field.maxLength}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [name]:
                              field.type === 'number' || field.type === 'integer'
                                ? event.target.value === ''
                                  ? ''
                                  : Number(event.target.value)
                                : event.target.value
                          }))
                        }
                      />
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div className="modal-foot mcp-elicit-actions">
          <button className="btn-ghost" onClick={() => void respond('cancel')} disabled={busy}>
            Vazgeç
          </button>
          <button
            className="btn-ghost danger"
            onClick={() => void respond('decline')}
            disabled={busy}
          >
            Reddet
          </button>
          <button className="btn" onClick={() => void respond('accept')} disabled={busy}>
            {request.mode === 'url' ? 'Tamamlandı' : 'Kabul et'}
          </button>
        </div>
      </div>
    </div>
  )
}
