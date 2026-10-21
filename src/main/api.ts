import type { ModelInfo, QuotaStatus } from '../shared/types'

export const DEFAULT_BASE_URL = 'https://evren-llmapi.ssyz.org.tr'

export class ApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  init?: RequestInit
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init?.headers ?? {})
      }
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ApiError(`Sunucuya ulaşılamadı (${url}): ${detail}`)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const text = await res.text()
      // JSON ise kisa bir mesaj cikar
      try {
        const parsed = JSON.parse(text)
        detail =
          parsed?.detail ?? parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? text
      } catch {
        detail = text
      }
    } catch {
      // yut
    }
    const message =
      typeof detail === 'string' && detail.trim()
        ? detail.trim().slice(0, 400)
        : `HTTP ${res.status}`
    throw new ApiError(message, res.status)
  }

  return (await res.json()) as T
}

export async function listModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const data = await request<{ data?: ModelInfo[] }>(baseUrl, '/v1/models', apiKey)
  return Array.isArray(data.data) ? data.data : []
}

export async function getQuota(baseUrl: string, apiKey: string): Promise<QuotaStatus> {
  return request<QuotaStatus>(baseUrl, '/v1/quota', apiKey)
}
