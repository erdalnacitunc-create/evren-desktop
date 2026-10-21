import type { CompactionResult } from '../../shared/types'
import { getSession, patchSession } from '../sessionStore'
import { getSettings } from '../settings'

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text?: string }).text ?? '')
          : ''
      )
      .join('')
  }
  return ''
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function estimateContentTokens(content: unknown): number {
  return estimateTokens(contentText(content)) + 8
}

export async function compactSession(
  sessionId: string,
  baseUrl: string,
  apiKey: string,
  focus?: string
): Promise<CompactionResult> {
  const session = await getSession(sessionId)
  if (!session) return { compacted: false, reason: 'Oturum bulunamadı.' }

  const settings = await getSettings()
  const keepTokens = settings.compaction?.keepTokens ?? 15_000
  const messages = session.messages
  if (messages.length === 0) return { compacted: false, reason: 'Sıkıştırılacak mesaj yok.' }

  let keep = 0
  let split = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateContentTokens(messages[index].content)
    if (keep + cost > keepTokens && split < messages.length) break
    keep += cost
    split = index
  }

  if (split >= messages.length && messages.length > 0) {
    split = messages.length - 1
  }

  const start = session.summaryMessageCount ?? 0
  const older = messages.slice(start, split)
  if (older.length === 0) {
    return { compacted: false, reason: 'Özetlenecek kadar eski mesaj yok.' }
  }

  const removedTokens = older.reduce(
    (sum, message) => sum + estimateContentTokens(message.content),
    0
  )
  const transcript = older
    .map((message) => {
      const text = contentText(message.content).slice(0, 4000)
      return `${message.role.toUpperCase()}: ${text}`
    })
    .join('\n\n')

  const prompt = [
    'Aşağıdaki konuşmayı, gelecekte devam edebilmek için yapılandırılmış bir özete dönüştür.',
    'Önceki özet varsa onu güncelle; sıfırdan başlama.',
    'Özet şu başlıkları içermeli:',
    '## Amaç',
    '## Kararlar',
    '## Tamamlananlar',
    '## Aktif İşler',
    '## Engeller / Sıradaki Adım',
    '## Dosyalar ve Referanslar',
    '## Kullanıcı Tercihleri',
    'Tam tool çıktılarını ve ara akıl yürütmeyi özetle; ham veriyi kopyalama.',
    focus ? `\nOdak: ${focus}` : '',
    `\nÖnceki özet:\n${session.summary ?? '(yok)'}`,
    `\nYeni konuşma:\n${transcript}`
  ]
    .filter(Boolean)
    .join('\n')

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: session.modelId,
      messages: [
        {
          role: 'system',
          content:
            'Sen bir oturum sıkıştırma modelisin. Konuşmayı kayıpsız sayılabilecek ' +
            'yapılandırılmış bir özete dönüştürürsün. Yalnızca özeti yaz.'
        },
        { role: 'user', content: prompt }
      ],
      stream: false,
      max_tokens: 3000,
      temperature: 0.2
    })
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      // yut
    }
    throw new Error(`Sıkıştırma hatası: HTTP ${response.status} ${detail}`.trim())
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning?: string } }>
  }
  const message = json.choices?.[0]?.message
  const summary =
    typeof message?.content === 'string' && message.content.trim()
      ? message.content
      : (message?.reasoning ?? '')

  if (!summary.trim()) {
    throw new Error('Sıkıştırma boş özet döndürdü.')
  }

  const compactedAt = Date.now()
  await patchSession(sessionId, {
    summary: summary.trim(),
    summaryMessageCount: split,
    compactedAt
  })

  return {
    compacted: true,
    summary: summary.trim(),
    summaryMessageCount: split,
    compactedAt,
    removedTokens,
    keptTokens: keep
  }
}
