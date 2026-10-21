import { openExternalSafe } from '../safeOpen'
import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { loadOAuthState, saveOAuthState, type OAuthState } from './oauthStore'

interface Waiter {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class CallbackServer {
  private server: Server | null = null
  private port = 0
  private code: string | null = null
  private waiter: Waiter | null = null
  private expectedState: string | null = null

  async start(): Promise<string> {
    if (this.server) return this.redirectUrl()
    this.server = createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    return this.redirectUrl()
  }

  redirectUrl(): string {
    return `http://127.0.0.1:${this.port}/callback`
  }

  setState(state: string): void {
    this.expectedState = state
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
    if (url.pathname !== '/callback') {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })

    if (error) {
      res.end('<h1>Yetkilendirme başarısız</h1><p>Uygulamaya dönebilirsiniz.</p>')
      this.settle(new Error(`OAuth hatası: ${error}`))
      return
    }

    if (this.expectedState && state && state !== this.expectedState) {
      res.end('<h1>State doğrulaması başarısız</h1>')
      this.settle(new Error('OAuth state doğrulaması başarısız.'))
      return
    }

    res.end('<h1>Yetkilendirme tamamlandı</h1><p>Bu pencereyi kapatabilirsiniz.</p>')
    if (code) this.settle(null, code)
    else this.settle(new Error('OAuth kodu dönmedi.'))
  }

  private settle(error: Error | null, code?: string): void {
    if (error) {
      if (this.waiter) {
        clearTimeout(this.waiter.timer)
        this.waiter.reject(error)
        this.waiter = null
      }
      return
    }
    if (!code) return
    if (this.waiter) {
      clearTimeout(this.waiter.timer)
      this.waiter.resolve(code)
      this.waiter = null
    } else {
      this.code = code
    }
  }

  waitForCode(timeoutMs: number): Promise<string> {
    if (this.code) {
      const code = this.code
      this.code = null
      return Promise.resolve(code)
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null
        reject(new Error('OAuth zaman aşımı. Tarayıcıda giriş tamamlanmadı.'))
      }, timeoutMs)
      this.waiter = { resolve, reject, timer }
    })
  }

  async close(): Promise<void> {
    if (this.waiter) {
      clearTimeout(this.waiter.timer)
      this.waiter = null
    }
    this.expectedState = null
    this.code = null
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

export class StoredOAuthProvider {
  private session: OAuthState

  constructor(
    private readonly serverId: string,
    private readonly callback: CallbackServer,
    private readonly redirectUri: string,
    session: OAuthState
  ) {
    this.session = session
  }

  static async create(
    serverId: string,
    callback: CallbackServer,
    redirectUri: string
  ): Promise<StoredOAuthProvider> {
    const state = await loadOAuthState(serverId)
    return new StoredOAuthProvider(serverId, callback, redirectUri, state)
  }

  get redirectUrl(): string {
    return this.redirectUri
  }

  get clientMetadata(): Record<string, unknown> {
    return {
      client_name: 'EVREN Desktop',
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    const value = randomUUID()
    this.callback.setState(value)
    return value
  }

  clientInformation(): Record<string, unknown> | undefined {
    return this.session.clientInformation
  }

  async saveClientInformation(info: Record<string, unknown>): Promise<void> {
    this.session.clientInformation = info
    await this.persist()
  }

  tokens(): OAuthState['tokens'] {
    return this.session.tokens
  }

  async saveTokens(tokens: NonNullable<OAuthState['tokens']>): Promise<void> {
    this.session.tokens = tokens
    await this.persist()
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    const opened = await openExternalSafe(url.toString())
    if (!opened) throw new Error('Yetkilendirme adresi yalnızca http(s) olabilir.')
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    this.session.codeVerifier = verifier
    await this.persist()
  }

  codeVerifier(): string {
    return this.session.codeVerifier ?? ''
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') this.session = {}
    if (scope === 'client') delete this.session.clientInformation
    if (scope === 'tokens') delete this.session.tokens
    if (scope === 'verifier') delete this.session.codeVerifier
    if (scope === 'discovery') delete this.session.discovery
    await this.persist()
  }

  private async persist(): Promise<void> {
    await saveOAuthState(this.serverId, this.session)
  }
}
