interface PdfTextItem {
  str?: string
}

interface PdfPage {
  getTextContent: () => Promise<{ items?: PdfTextItem[] }>
}

interface PdfDocument {
  numPages: number
  getPage: (page: number) => Promise<PdfPage>
  destroy: () => Promise<void>
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>
  destroy?: () => Promise<void>
}

interface PdfModule {
  getDocument: (options: Record<string, unknown>) => PdfLoadingTask
}

const MAX_PDF_BYTES = 25 * 1024 * 1024
const MAX_PDF_PAGES = 60
const MAX_PDF_CHARS = 80_000

export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error('PDF çok büyük (25 MB sınırı).')
  }
  // @ts-expect-error pdfjs legacy build is ESM and has no declaration for this subpath
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfModule
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0
  })
  const document = await loadingTask.promise

  try {
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES)
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = (content.items ?? [])
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) pages.push(`[Sayfa ${pageNumber}]\n${text}`)
    }
    const result = pages.join('\n\n')
    return result.slice(0, MAX_PDF_CHARS)
  } finally {
    await loadingTask.destroy?.().catch(() => undefined)
  }
}
