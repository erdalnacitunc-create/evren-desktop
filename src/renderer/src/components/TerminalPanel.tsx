import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalStatus } from '@shared/types'
import { api } from '../lib/ipc'

interface Props {
  workspacePath: string | null
  onClose: () => void
}

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g

function clean(text: string): string {
  return text.replace(ANSI, '').replace(/\r/g, '')
}

export function TerminalPanel({ workspacePath, onClose }: Props): React.JSX.Element {
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
          <strong>Terminal</strong>
          <span className="muted">{status?.cwd ?? workspacePath ?? '—'}</span>
        </div>
        <div className="terminal-actions">
          <button className="btn-ghost" onClick={() => setOutput('')}>
            Temizle
          </button>
          <button
            className="btn-ghost"
            onClick={() => void interrupt()}
            title="Çalışan komutu durdurur ve oturumu yeniden başlatır"
          >
            Ctrl+C
          </button>
          <button className="btn-ghost" onClick={() => void restart()}>
            Yeniden başlat
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              void api.terminal.stop()
              onClose()
            }}
          >
            Kapat
          </button>
        </div>
      </div>
      <pre className="terminal-output" ref={outputRef}>
        {output || 'Terminal hazır.\n'}
      </pre>
      <div className="terminal-input-row">
        <span className="terminal-prompt">PS&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Komut yazıp Enter'a basın..."
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  )
}
