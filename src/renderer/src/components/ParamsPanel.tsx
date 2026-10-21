import type { ChatDefaults, ModelInfo } from '@shared/types'

interface Props {
  model: ModelInfo
  defaults: ChatDefaults
  onChange: (patch: Partial<ChatDefaults>) => void
}

export function ParamsPanel({ model, defaults, onChange }: Props): React.JSX.Element {
  const capabilities = model.capabilities
  const effortValues =
    capabilities?.reasoning_effort_values ??
    (capabilities?.reasoning_effort ? ['low', 'medium', 'high'] : [])

  return (
    <div className="params-panel">
      <div className="params-row">
        <label>
          <span>Sıcaklık</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={defaults.temperature ?? 0.7}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>top_p</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={defaults.top_p ?? 1}
            onChange={(e) => onChange({ top_p: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="params-block">
        <span>Maks. çıktı token</span>
        <input
          type="number"
          min={1}
          max={1000000}
          step={256}
          value={defaults.max_tokens ?? model.default_max_output_tokens ?? 4096}
          onChange={(e) => onChange({ max_tokens: Number(e.target.value) })}
        />
      </label>

      {capabilities?.reasoning_effort && (
        <label className="params-block">
          <span>Akıl yürütme eforu</span>
          <select
            value={defaults.reasoning_effort ?? ''}
            onChange={(e) => onChange({ reasoning_effort: e.target.value || undefined })}
          >
            <option value="">Varsayılan</option>
            {effortValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}

      {capabilities?.thinking && (
        <label className="params-check">
          <input
            type="checkbox"
            checked={defaults.thinking ?? false}
            onChange={(e) => onChange({ thinking: e.target.checked })}
          />
          <span>Düşünme (thinking) açık</span>
        </label>
      )}

      {!capabilities?.reasoning_effort && !capabilities?.thinking && (
        <p className="params-note">Bu model düşünme parametrelerini desteklemiyor.</p>
      )}
    </div>
  )
}
