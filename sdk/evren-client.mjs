/**
 * EVREN Desktop Headless API için küçük JavaScript SDK.
 *
 * Örnek:
 *   const client = new EvrenClient({ token: process.env.EVREN_HEADLESS_TOKEN })
 *   for await (const text of client.stream([{ role: 'user', content: 'Merhaba' }])) {
 *     process.stdout.write(text)
 *   }
 */

export class EvrenHttpError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'EvrenHttpError'
    this.status = status
    this.body = body
  }
}

export class EvrenClient {
  constructor({
    baseUrl = process.env.EVREN_HEADLESS_URL || 'http://127.0.0.1:45871',
    token = process.env.EVREN_HEADLESS_TOKEN,
    fetchImpl = globalThis.fetch
  } = {}) {
    if (!token) throw new Error('EvrenClient: token gerekli (EVREN_HEADLESS_TOKEN).')
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
    this.fetchImpl = fetchImpl
  }

  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...extra
    }
  }

  async request(path, { method = 'GET', body, signal, headers } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      signal,
      headers: this.headers(headers),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!response.ok) {
      const message =
        data?.error?.message || data?.detail || data?.message || `HTTP ${response.status}`
      throw new EvrenHttpError(String(message), response.status, data)
    }
    return data
  }

  async health() {
    const response = await this.fetchImpl(`${this.baseUrl}/health`)
    if (!response.ok) throw new EvrenHttpError('Sağlık kontrolü başarısız.', response.status)
    return response.json()
  }

  async models() {
    const data = await this.request('/v1/models')
    return data?.data ?? data
  }

  async resolveModel(model) {
    if (model) return model
    const models = await this.models()
    const chat = models.find(
      (item) => item.task === 'chat' || item.task === 'vision_chat' || item.object === 'model'
    )
    if (!chat) throw new Error('Kullanılabilir sohbet modeli bulunamadı.')
    return chat.id
  }

  async chat(messages, options = {}) {
    const model = await this.resolveModel(options.model)
    const { model: _ignored, signal, ...rest } = options
    return this.request('/v1/chat/completions', {
      method: 'POST',
      signal,
      body: { model, messages, stream: false, ...rest }
    })
  }

  /**
   * SSE akışından metin parçaları üretir.
   */
  async *stream(messages, options = {}) {
    const model = await this.resolveModel(options.model)
    const { model: _ignored, signal, onChunk, ...rest } = options
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: this.headers({ Accept: 'text/event-stream' }),
      body: JSON.stringify({ model, messages, stream: true, ...rest })
    })

    if (!response.ok) {
      const text = await response.text()
      let detail = text
      try {
        const parsed = JSON.parse(text)
        detail = parsed?.error?.message || parsed?.detail || parsed?.message || text
      } catch {
        // düz metin
      }
      throw new EvrenHttpError(String(detail), response.status, text)
    }
    if (!response.body) throw new Error('Yanıt gövdesi yok.')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          let chunk
          try {
            chunk = JSON.parse(data)
          } catch {
            continue
          }
          if (onChunk) onChunk(chunk)
          const text = chunk?.choices?.[0]?.delta?.content
          if (typeof text === 'string' && text) yield text
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  sessions = {
    list: () => this.request('/v1/sessions'),
    create: (model) => this.request('/v1/sessions', { method: 'POST', body: { model } }),
    get: (id) => this.request(`/v1/sessions/${encodeURIComponent(id)}`),
    delete: (id) =>
      this.request(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

export function createEvrenClient(options) {
  return new EvrenClient(options)
}

export default EvrenClient
