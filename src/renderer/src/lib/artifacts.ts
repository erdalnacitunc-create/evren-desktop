export interface Artifact {
  id: string
  title: string
  language: string
  content: string
  bytes: number
}

const EXTENSIONS: Record<string, string> = {
  md: 'md',
  markdown: 'md',
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  json: 'json',
  py: 'py',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sh: 'sh',
  bash: 'sh',
  sql: 'sql',
  yaml: 'yml',
  yml: 'yml',
  xml: 'xml',
  txt: 'txt'
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'notlar'
  )
}

export function extractArtifacts(markdown: string, key: string): Artifact[] {
  const artifacts: Artifact[] = []
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let index = 0

  while ((match = fence.exec(markdown)) !== null) {
    index += 1
    const header = match[1].trim()
    const content = match[2]
    const tokens = header.split(/\s+/).filter(Boolean)
    const language = tokens[0] ?? ''
    let title = ''

    for (const token of tokens.slice(1)) {
      const named = /^(?:title|filename|file|name)=["']?([^"']+)["']?$/i.exec(token)
      if (named) {
        title = named[1]
        break
      }
    }

    if (!title && tokens.length > 1) {
      const bare = tokens
        .slice(1)
        .find((token) => /^[\w./-]+\.[a-z0-9]{1,8}$/i.test(token))
      if (bare) title = bare
    }

    if (!title && /^(md|markdown)$/i.test(language)) {
      const heading = /^#\s+(.+)$/m.exec(content)
      title = heading ? `${slug(heading[1])}.md` : `notlar-${index}.md`
    }

    if (!title && content.length >= 120) {
      const extension = EXTENSIONS[language.toLowerCase()] ?? 'txt'
      title = `parca-${index}.${extension}`
    }

    if (!title) continue

    artifacts.push({
      id: `${key}:${index}`,
      title,
      language,
      content,
      bytes: new TextEncoder().encode(content).length
    })
  }

  return artifacts
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
