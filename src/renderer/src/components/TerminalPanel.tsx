import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { TerminalStatus } from '@shared/types'
import { api } from '../lib/ipc'
import { useI18n } from '../i18n'

interface Props {
  workspacePath: string | null
  onClose: () => void
}

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g

function clean(text: string): string {
  return text.replace(ANSI, '').replace(/\r/g, '')
}

const XTERM_THEME = {
  background: '#070d18',
  foreground: '#c8d6e8',
  cursor: '#6ee7b7',
  selectionBackground: '#1e3a5f',
  black: '#1e293b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc'
}

/** Gerçek PTY oturumu — xterm.js yüzeyi. */
function PtyTerminal({ workspacePath, onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const [status, setStatus] = useState<TerminalStatus | null>(null)
  const [restartKey, setRestartKey] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'ui-monospace, Consolas, "Cascadia Mono", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: XTERM_THEME,
      allowProposedApi: true
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      // görünür değilse boyut hesaplanamaz
    }

    let disposed = false
    const offRaw = api.terminal.onRaw((payload) => {
      if (!disposed) term.write(payload.data)
    })
    const offExit = api.terminal.onExit((payload) => {
      if (disposed) return
      term.write(`\r\n\x1b[90m[süreç sona erdi: ${payload.code ?? payload.signal ?? 0}]\x1b[0m\r\n`)
      setStatus((current) => (current ? { ...current, running: false } : current))
    })
    const inputSub = term.onData((data) => {
      void api.terminal.ptyWrite(data)
    })

    void api.terminal.start(workspacePath ?? undefined, term.cols, term.rows).then((result) => {
      if (disposed) return
      if (result.ok) {
        setStatus(result.data)
        if (!result.data.running && result.data.error) {
          term.write(`\x1b[31m${result.data.error}\x1b[0m\r\n`)
        }
      }
    })

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        return
      }
      void api.terminal.ptyResize(term.cols, term.rows)
    })
    observer.observe(host)
    term.focus()

    return () => {
      disposed = true
      observer.disconnect()
      inputSub.dispose()
      offRaw()
      offExit()
      term.dispose()
      termRef.current = null
      void api.terminal.stop()
    }
  }, [restartKey, workspacePath])

  const restart = useCallback((): void => {
    setStatus(null)
    setRestartKey((key) => key + 1)
  }, [])

  return (
    <div className="terminal-panel">
      <div className="terminal-head">
        <div className="terminal-title">
          <span className={`terminal-dot ${status?.running ? 'on' : ''}`} />
          <strong>{t('terminal.title')}</strong>
          <span className="muted">{status?.cwd ?? workspacePath ?? '—'}</span>
        </div>
        <div className="terminal-actions">
          <button
            className="btn-ghost"
            onClick={() => termRef.current?.clear()}
            title={t('terminal.clear')}
          >
            {t('terminal.clear')}
          </button>
          <button
            className="btn-ghost"
            onClick={() => void api.terminal.interrupt()}
            title={t('terminal.interrupt')}
          >
            {t('terminal.interrupt')}
          </button>
          <button className="btn-ghost" onClick={restart}>
            {t('terminal.restart')}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              void api.terminal.stop()
              onClose()
            }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
      <div className="terminal-pty" ref={hostRef} />
    </div>
  )
}

/** PTY yüklenemezse kullanılan boru tabanlı yedek yüzey. */
function PipeTerminal({ workspacePath, onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<TerminalStatus | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const outputRef = useRef<HTMLPreElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const start = useCallback(async (): Promise<void> => {
    const result = await api.terminal.start(workspacePath ?? undefined)
    if (result.ok) setStatus(result.data)
  }, [workspacePath])

  useEffect(() => {
    const offData = api.terminal.onData((payload) => {
      setOutput((current) => clean(current + payload.data).slice(-250_000))
    })
    const offExit = api.terminal.onExit(() => {
      setStatus((current) => (current ? { ...current, running: false } : current))
    })
    void start()
    return () => {
      offData()
      offExit()
      void api.terminal.stop()
    }
  }, [start])

  useEffect(() => {
    const element = outputRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output])

  const send = useCallback(async (): Promise<void> => {
    const value = input
    if (!value.trim()) return
    setHistory((current) => [value, ...current].slice(0, 100))
    setHistoryIndex(-1)
    setInput('')
    await api.terminal.write(`${value}\n`)
    inputRef.current?.focus()
  }, [input])

  const restart = useCallback(async (): Promise<void> => {
    setOutput('')
    await api.terminal.stop()
    await start()
  }, [start])

  const interrupt = useCallback(async (): Promise<void> => {
    await api.terminal.interrupt()
    await start()
  }, [start])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void send()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.min(history.length - 1, historyIndex + 1)
      if (next >= 0) {
        setHistoryIndex(next)
        setInput(history[next])
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setInput(next >= 0 ? history[next] ?? '' : '')
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      void interrupt()
    }
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-head">
        <div className="terminal-title">
          <span className={`terminal-dot ${status?.running ? 'on' : ''}`} />
          <strong>{t('terminal.title')}</strong>
          <span className="muted">{status?.cwd ?? workspacePath ?? '—'}</span>
        </div>
        <div className="terminal-actions">
          <button className="btn-ghost" onClick={() => setOutput('')}>
            {t('terminal.clear')}
          </button>
          <button className="btn-ghost" onClick={() => void interrupt()} title={t('terminal.interrupt')}>
            {t('terminal.interrupt')}
          </button>
          <button className="btn-ghost" onClick={() => void restart()}>
            {t('terminal.restart')}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              void api.terminal.stop()
              onClose()
            }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
      <pre className="terminal-output" ref={outputRef}>
        {output || `${t('terminal.ready')}\n`}
      </pre>
      <div className="terminal-input-row">
        <span className="terminal-prompt">PS&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('terminal.inputPlaceholder')}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  )
}

export function TerminalPanel(props: Props): React.JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = useState<'pty' | 'pipe' | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.terminal.status().then((result) => {
      if (cancelled) return
      const detected = result.ok ? result.data.mode ?? 'pty' : 'pipe'
      setMode(detected === 'pipe' ? 'pipe' : 'pty')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (mode === null) {
    return (
      <div className="terminal-panel">
        <div className="terminal-head">
          <div className="terminal-title">
            <span className="terminal-dot" />
            <strong>{t('terminal.title')}</strong>
          </div>
        </div>
        <pre className="terminal-output">{t('common.loading')}</pre>
      </div>
    )
  }

  return mode === 'pty' ? <PtyTerminal {...props} /> : <PipeTerminal {...props} />
}