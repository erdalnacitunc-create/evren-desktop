import { ApiError, listModels } from './api'
import { loadApiKey } from './credentials'
import { getSettings } from './settings'

export interface TranscriptionInput {
  data: ArrayBuffer
  mimeType: string
  filename?: string
  language?: string
  model?: string
}

export interface TranscriptionResult {
  text: string
  model: string
}

let cachedModel: string | null = null

async function resolveModel(baseUrl: string, key: string, requested?: string): Promise<string> {
  if (requested && requested.trim()) return requested.trim()
  if (cachedModel) return cachedModel
  try {
    const models = await listModels(baseUrl, key)
    const model = models.find((item) => item.task === 'audio_transcription')
    if (model?.id) {
      cachedModel = model.id
      return model.id
    }
  } catch {
    // model listesi alınamazsa fallback
  }
  cachedModel = 'qwen3-asr-1.7b'
  return cachedModel
}

export async function transcribeAudio(input: TranscriptionInput): Promise<TranscriptionResult> {
  const [key, settings] = await Promise.all([loadApiKey(), getSettings()])
  if (!key) throw new ApiError('API anahtarı bulunamadı.')
  if (!input.data || input.data.byteLength === 0) {
    throw new ApiError('Ses kaydı boş.')
  }
  if (input.data.byteLength > 25 * 1024 * 1024) {
    throw new ApiError('Ses kaydı çok büyük (25 MB sınırı).')
  }

  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  const model = await resolveModel(baseUrl, key, input.model)
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(input.data)], {
      type: input.mimeType || 'audio/webm'
    }),
    input.filename || 'kayit.webm'
  )
  form.append('model', model)
  form.append('response_format', 'json')
  if (input.language && input.language.trim()) {
    form.append('language', input.language.trim())
  }

  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 400)
    } catch {
      // yut
    }
    throw new ApiError(`Transkripsiyon hatası: HTTP ${response.status} ${detail}`.trim(), response.status)
  }

  const json = (await response.json()) as {
    text?: string
    transcription?: string
    result?: string
  }
  const text = (json.text ?? json.transcription ?? json.result ?? '').trim()
  if (!text) throw new ApiError('Transkripsiyon boş sonuç döndürdü.')
  return { text, model }
}
