import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error:', error, info)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  private reload = (): void => {
    window.location.reload()
  }

  private copy = async (): Promise<void> => {
    const error = this.state.error
    const text = `${error?.name ?? 'Error'}: ${error?.message ?? ''}\n\n${
      error?.stack ?? ''
    }\n${this.state.componentStack}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // pano izni yoksa yoksay
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal-error">
        <div className="fatal-card">
          <div className="fatal-icon">!</div>
          <h1>Bir şeyler ters gitti</h1>
          <p>
            Arayüz beklenmeyen bir hatayla karşılaştı. Sohbetleriniz ve ayarlarınız
            yerel olarak korunuyor.
          </p>
          <pre>
            {this.state.error.name}: {this.state.error.message}
            {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
            {this.state.componentStack ? `\n${this.state.componentStack}` : ''}
          </pre>
          <div className="fatal-actions">
            <button className="btn-ghost" onClick={() => void this.copy()}>
              Hatayı kopyala
            </button>
            <button className="btn" onClick={this.reload}>
              Arayüzü yeniden yükle
            </button>
          </div>
        </div>
      </div>
    )
  }
}
