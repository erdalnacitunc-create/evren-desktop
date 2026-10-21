import type { SubagentTaskInfo, TodoItem } from '@shared/types'

interface Props {
  todos: TodoItem[]
  subagentTasks: SubagentTaskInfo[]
  onToggle: (id: string) => void
  onClear: () => void
  onCancelSubagent: (id: string) => void
  onRetrySubagent: (id: string) => void
  onClose: () => void
}

function statusLabel(status: TodoItem['status']): string {
  if (status === 'completed') return 'Tamamlandı'
  if (status === 'in_progress') return 'Devam ediyor'
  return 'Bekliyor'
}

function taskStatusLabel(status: SubagentTaskInfo['status']): string {
  if (status === 'done') return 'tamam'
  if (status === 'error') return 'hata'
  if (status === 'cancelled') return 'iptal'
  if (status === 'interrupted') return 'kesildi'
  return 'çalışıyor'
}

export function TasksPanel({
  todos,
  subagentTasks,
  onToggle,
  onClear,
  onCancelSubagent,
  onRetrySubagent,
  onClose
}: Props): React.JSX.Element {
  const done = todos.filter((todo) => todo.status === 'completed').length
  const percent = todos.length > 0 ? Math.round((done / todos.length) * 100) : 0
  const hasTasks = todos.length > 0 || subagentTasks.length > 0

  return (
    <aside className="review-pane tasks-pane" aria-label="Görevler">
      <div className="review-head">
        <div>
          <div className="review-title">Görevler</div>
          <div className="review-meta">
            {todos.length > 0
              ? `${done}/${todos.length} tamamlandı`
              : subagentTasks.length > 0
                ? `${subagentTasks.length} alt ajan`
                : 'Henüz görev yok'}
            {todos.length > 0 && subagentTasks.length > 0
              ? ` · ${subagentTasks.length} alt ajan`
              : ''}
          </div>
        </div>
        <button className="btn-ghost" onClick={onClose} title="Kapat">
          ✕
        </button>
      </div>

      {todos.length > 0 && (
        <div className="tasks-progress">
          <div className="tasks-progress-track">
            <div className="tasks-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span>{percent}%</span>
        </div>
      )}

      <div className="tasks-body">
        {!hasTasks ? (
          <div className="tasks-empty">
            <p>Model çok adımlı bir işe başladığında görev listesi burada görünür.</p>
            <p className="muted">
              Plan modunda model önce bir plan ve görev listesi üretir; Build modunda
              adımları işaretler. Arka plan alt-ajanları da burada listelenir.
            </p>
          </div>
        ) : (
          <>
            {subagentTasks.length > 0 && (
              <div className="subagent-task-list">
                <div className="tasks-section-title">Arka plan alt-ajanları</div>
                {subagentTasks.map((task) => (
                  <details
                    key={task.id}
                    className={`subagent-task subagent-${task.status}`}
                  >
                    <summary>
                      <span className="subagent-agent">{task.agentType}</span>
                      <span className="subagent-prompt" title={task.prompt}>
                        {task.prompt}
                      </span>
                      <span className={`subagent-status subagent-status-${task.status}`}>
                        {taskStatusLabel(task.status)}
                      </span>
                    </summary>
                    {task.status === 'running' && (
                      <button
                        className="btn-ghost danger subagent-cancel"
                        onClick={() => onCancelSubagent(task.id)}
                      >
                        Durdur
                      </button>
                    )}
                    {task.status !== 'running' && task.status !== 'done' && (
                      <button
                        className="btn-ghost subagent-cancel"
                        onClick={() => onRetrySubagent(task.id)}
                        title="Görevi yeniden çalıştır"
                      >
                        Yeniden dene{task.attempts ? ` (${task.attempts})` : ''}
                      </button>
                    )}
                    {task.result && <pre className="subagent-result">{task.result}</pre>}
                    {task.error && <p className="error subagent-error">{task.error}</p>}
                  </details>
                ))}
              </div>
            )}

            {todos.length > 0 && (
              <>
                <div className="tasks-section-title">Plan görevleri</div>
                <ul className="tasks-list">
                  {todos.map((todo) => (
                    <li key={todo.id} className={`tasks-item tasks-${todo.status}`}>
                      <button
                        className="tasks-check"
                        onClick={() => onToggle(todo.id)}
                        title={statusLabel(todo.status)}
                        aria-label={statusLabel(todo.status)}
                      >
                        {todo.status === 'completed'
                          ? '✓'
                          : todo.status === 'in_progress'
                            ? '◐'
                            : '○'}
                      </button>
                      <span className="tasks-text">{todo.content}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {todos.length > 0 && (
        <div className="tasks-footer">
          <button className="btn-ghost danger" onClick={onClear}>
            Listeyi temizle
          </button>
        </div>
      )}
    </aside>
  )
}
