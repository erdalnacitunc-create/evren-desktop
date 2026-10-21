import { ApiError } from '../api'

export const EMBEDDING_MODEL = 'qwen3-embedding-8b'

export async function embedTexts(
  baseUrl: string,
  apiKey: string,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return []

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts })
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      // yut
    }
    throw new ApiError(`Embedding hatası: HTTP ${response.status} ${detail}`.trim(), response.status)
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>
  }
  return (json.data ?? []).map((item) => item.embedding ?? [])
}

export async function embedText(
  baseUrl: string,
  apiKey: string,
  text: string
): Promise<number[] | null> {
  try {
    const [embedding] = await embedTexts(baseUrl, apiKey, [text])
    return embedding && embedding.length > 0 ? embedding : null
  } catch {
    return null
  }
}
