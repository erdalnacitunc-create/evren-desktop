import type {
  AgentMode,
  AppSettings,
  HookSettings,
  PermissionAction,
  PermissionSettings
} from '@shared/types'
import {
  PERMISSION_CATEGORIES,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS
} from '@shared/permissions'

interface Props {
  mode: AgentMode
  browser: boolean
  computer: boolean
  workspace: boolean
  workspacePath: string | null
  permissions: PermissionSettings
  hooks?: HookSettings
  onChange: (patch: Partial<AppSettings>) => void
  onChooseWorkspace: () => void
  onClearWorkspace: () => void
}

const ACTION_LABELS: Record<PermissionAction, string> = {
  ask: 'Sor',
  allow: 'İzin',
  deny: 'Engelle'
}

export function AgentPanel({
  mode,
  browser,
  computer,
  workspace,
  workspacePath,
  permissions,
  hooks,
  onChange,
  onChooseWorkspace,
  onClearWorkspace
}: Props): React.JSX.Element {
  return (
    <div className="params-panel agent-panel">
      <div className="agent-block">
        <span className="agent-label">Çalışma modu</span>
        <div className="segmented">
          <button
            className={mode === 'confirm' ? 'active' : ''}
            onClick={() => onChange({ agentMode: 'confirm' })}
          >
            Onaylı
          </button>
          <button
            className={mode === 'auto' ? 'active danger' : ''}
            onClick={() => onChange({ agentMode: 'auto' })}
          >
            Otomatik
          </button>
        </div>
        <p className="params-note">
          {mode === 'confirm'
            ? 'Her araç eylemi öncesinde onay istenir.'
            : 'Ajan eylemleri onay istemeden uygular. Dikkatli kullanın.'}
        </p>
      </div>

      <div className="agent-block">
        <span className="agent-label">Dosya araçları</span>
        <label className="params-check">
          <input
            type="checkbox"
            checked={workspace}
            onChange={(e) => onChange({ workspaceTools: e.target.checked })}
          />
          <span>Dosya oku / yaz / düzenle / komut çalıştır</span>
        </label>
        <div className="ws-agent-path" title={workspacePath ?? ''}>
          {workspacePath ?? 'Klasör seçilmedi'}
        </div>
        <div className="inline-actions">
          <button className="btn-ghost" onClick={onChooseWorkspace}>
            Klasör Seç
          </button>
          {workspacePath && (
            <button className="btn-ghost danger" onClick={onClearWorkspace}>
              Kaldır
            </button>
          )}
        </div>
        <p className="params-note">
          Model yalnızca seçilen klasörde dosya oluşturabilir/düzenleyebilir. Her değişiklik
          yedeklenir ve geri alınabilir.
        </p>
      </div>

      <label className="params-check">
        <input
          type="checkbox"
          checked={browser}
          onChange={(e) => onChange({ browserTools: e.target.checked })}
        />
        <span>Tarayıcı kontrolü (Edge / Playwright)</span>
      </label>

      <p className="params-note">
        Araçlar, araç destekleyen modellerde varsayılan olarak açıktır. Buradan
        kapatabilir veya kapsamı değiştirebilirsiniz.
      </p>

      <label className="params-check">
        <input
          type="checkbox"
          checked={computer}
          onChange={(e) => onChange({ computerTools: e.target.checked })}
        />
        <span>Bilgisayar kontrolü (deneysel)</span>
      </label>

      {computer && (
        <p className="params-warn">
          Bilgisayar kontrolü fare ve klavyeyi yönetir. Ekran görüntüleri modele
          gönderilir. Yalnızca güvendiğiniz görevlerde kullanın.
        </p>
      )}

      <details className="permissions-details">
        <summary>İzinler (gelişmiş)</summary>
        <p className="params-note">
          Varsayılan: Onaylı modda “Sor”, Otomatik modda “İzin”. Kategori bazında
          değiştirebilirsiniz.
        </p>
        {PERMISSION_CATEGORIES.map((category) => {
          const current = permissions[category] ?? (mode === 'auto' ? 'allow' : 'ask')
          return (
            <div className="permission-row" key={category}>
              <span title={PERMISSION_DESCRIPTIONS[category]}>
                {PERMISSION_LABELS[category]}
              </span>
              <div className="permission-actions">
                {(['ask', 'allow', 'deny'] as PermissionAction[]).map((action) => (
                  <button
                    key={action}
                    className={`${current === action ? 'active' : ''} ${
                      action === 'deny' ? 'danger' : ''
                    }`}
                    onClick={() =>
                      onChange({
                        permissions: { ...permissions, [category]: action }
                      })
                    }
                  >
                    {ACTION_LABELS[action]}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <button className="btn-ghost permissions-reset" onClick={() => onChange({ permissions: {} })}>
          Varsayılana dön
        </button>
      </details>

      <div className="agent-block hooks-block">
        <span className="agent-label">Kancalar</span>
        <label className="params-check">
          <input
            type="checkbox"
            checked={hooks?.formatOnEdit === true}
            onChange={(event) =>
              onChange({
                hooks: {
                  formatOnEdit: event.target.checked,
                  preCommitChecks: hooks?.preCommitChecks === true
                }
              })
            }
          />
          <span>Düzenleme sonrası Prettier ile formatla</span>
        </label>
        <label className="params-check">
          <input
            type="checkbox"
            checked={hooks?.preCommitChecks === true}
            onChange={(event) =>
              onChange({
                hooks: {
                  formatOnEdit: hooks?.formatOnEdit === true,
                  preCommitChecks: event.target.checked
                }
              })
            }
          />
          <span>Commit öncesi kontrolleri çalıştır</span>
        </label>
        <p className="params-note">
          Format hook’u projedeki <code>node_modules/prettier</code> varsa çalışır. Kontroller
          typecheck/lint/test scriptlerini kullanır.
        </p>
      </div>

      {mode === 'auto' && (
        <p className="params-warn danger">
          Otomatik mod etkin: ajan siz müdahale etmeden eylem yapabilir.
        </p>
      )}
    </div>
  )
}
