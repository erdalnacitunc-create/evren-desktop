import { chromium, type Browser, type Page } from 'playwright-core'

const INTERACTIVE_SELECTOR =
  'a,button,input,textarea,select,[role="button"],[contenteditable="true"]'

interface BrowserConsoleEntry {
  at: number
  type: string
  text: string
  url?: string
  line?: number
}

interface BrowserNetworkEntry {
  at: number
  method: string
  url: string
  resourceType: string
  status?: number
  ok?: boolean
  failure?: string
}

export class BrowserSession {
  private browser: Browser | null = null
  private page: Page | null = null
  private consoleEntries: BrowserConsoleEntry[] = []
  private networkEntries: BrowserNetworkEntry[] = []

  private attachDiagnostics(page: Page): void {
    page.on('console', (message) => {
      const location = message.location()
      this.consoleEntries.push({
        at: Date.now(),
        type: message.type(),
        text: message.text().slice(0, 4000),
        url: location.url || undefined,
        line: location.lineNumber
      })
      if (this.consoleEntries.length > 300) this.consoleEntries.shift()
    })
    page.on('pageerror', (error) => {
      this.consoleEntries.push({
        at: Date.now(),
        type: 'pageerror',
        text: String(error?.message ?? error).slice(0, 4000)
      })
      if (this.consoleEntries.length > 300) this.consoleEntries.shift()
    })
    page.on('response', (response) => {
      const request = response.request()
      this.networkEntries.push({
        at: Date.now(),
        method: request.method(),
        url: response.url(),
        resourceType: request.resourceType(),
        status: response.status(),
        ok: response.ok()
      })
      if (this.networkEntries.length > 300) this.networkEntries.shift()
    })
    page.on('requestfailed', (request) => {
      this.networkEntries.push({
        at: Date.now(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText ?? 'request failed'
      })
      if (this.networkEntries.length > 300) this.networkEntries.shift()
    })
  }

  async ensure(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page

    this.browser = await chromium.launch({
      channel: 'msedge',
      headless: process.env['EVREN_BROWSER_HEADLESS'] === '1'
    })
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 }
    })
    this.page = await context.newPage()
    this.attachDiagnostics(this.page)
    return this.page
  }

  async close(): Promise<void> {
    try {
      if (this.browser) await this.browser.close()
    } catch {
      // yut
    } finally {
      this.browser = null
      this.page = null
      this.consoleEntries = []
      this.networkEntries = []
    }
  }

  async snapshot(): Promise<string> {
    const page = await this.ensure()
    const data = await page.evaluate((selector) => {
      document.querySelectorAll('[data-evren-ref]').forEach((el) => {
        el.removeAttribute('data-evren-ref')
      })

      const elements = [...document.querySelectorAll(selector)].slice(0, 80)
      const items = elements.map((el, index) => {
        const ref = String(index + 1)
        el.setAttribute('data-evren-ref', ref)
        const input = el as HTMLInputElement
        return {
          ref,
          tag: el.tagName.toLowerCase(),
          type: input.type || undefined,
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
          name: input.name || undefined,
          placeholder: input.placeholder || undefined,
          href: (el as HTMLAnchorElement).href || undefined
        }
      })

      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 3500),
        elements: items
      }
    }, INTERACTIVE_SELECTOR)

    return JSON.stringify(data, null, 2)
  }

  async open(url: string): Promise<string> {
    const page = await this.ensure()
    this.consoleEntries = []
    this.networkEntries = []
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return this.snapshot()
  }

  async click(args: Record<string, unknown>): Promise<string> {
    const page = await this.ensure()
    const ref = typeof args.ref === 'string' ? args.ref : ''
    const text = typeof args.text === 'string' ? args.text : ''
    const selector = typeof args.selector === 'string' ? args.selector : ''

    if (ref) {
      await page.click(`[data-evren-ref="${ref}"]`, { timeout: 10_000 })
    } else if (text) {
      await page.getByText(text, { exact: false }).first().click({ timeout: 10_000 })
    } else if (selector) {
      await page.click(selector, { timeout: 10_000 })
    } else {
      throw new Error('click icin ref, text veya selector gerekli.')
    }

    await page.waitForTimeout(500)
    return this.snapshot()
  }

  async type(args: Record<string, unknown>): Promise<string> {
    const page = await this.ensure()
    const ref = typeof args.ref === 'string' ? args.ref : ''
    const selector = typeof args.selector === 'string' ? args.selector : ''
    const value = String(args.text ?? '')

    if (!value) throw new Error('type icin text gerekli.')

    if (ref) {
      await page.fill(`[data-evren-ref="${ref}"]`, value, { timeout: 10_000 })
    } else if (selector) {
      await page.fill(selector, value, { timeout: 10_000 })
    } else {
      await page.keyboard.type(value)
    }

    if (args.submit === true) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(700)
    }

    return this.snapshot()
  }

  async pressKey(keys: string): Promise<string> {
    const page = await this.ensure()
    await page.keyboard.press(keys)
    await page.waitForTimeout(300)
    return this.snapshot()
  }

  async screenshot(): Promise<string> {
    const page = await this.ensure()
    const buffer = await page.screenshot({ type: 'png' })
    return `data:image/png;base64,${buffer.toString('base64')}`
  }

  async console(level?: string, limit = 100): Promise<string> {
    await this.ensure()
    const normalized = String(level ?? '').toLowerCase()
    const entries = this.consoleEntries
      .filter((entry) => !normalized || entry.type.toLowerCase() === normalized)
      .slice(-Math.max(1, Math.min(300, Math.round(limit))))
    return JSON.stringify(
      { total: this.consoleEntries.length, entries },
      null,
      2
    )
  }

  async network(filter?: string, limit = 100): Promise<string> {
    await this.ensure()
    const needle = String(filter ?? '').toLowerCase()
    const entries = this.networkEntries
      .filter((entry) => !needle || entry.url.toLowerCase().includes(needle))
      .slice(-Math.max(1, Math.min(300, Math.round(limit))))
    return JSON.stringify(
      { total: this.networkEntries.length, entries },
      null,
      2
    )
  }

  async evaluate(script: string): Promise<string> {
    const page = await this.ensure()
    const result = await page.evaluate((source) => {
      // eslint-disable-next-line no-eval
      return (0, eval)(source)
    }, script)
    const serialized =
      typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return String(serialized ?? 'undefined').slice(0, 30_000)
  }

  async html(selector?: string): Promise<string> {
    const page = await this.ensure()
    if (selector) {
      const html = await page.evaluate((value) => {
        const element = document.querySelector(value)
        if (!element) throw new Error(`Selector bulunamadı: ${value}`)
        return element.innerHTML
      }, selector)
      return html.slice(0, 60_000)
    }
    return (await page.content()).slice(0, 60_000)
  }

  async performance(): Promise<string> {
    const page = await this.ensure()
    const data = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      const resources = performance
        .getEntriesByType('resource')
        .slice(-120)
        .map((entry) => ({
          name: entry.name,
          type: (entry as PerformanceResourceTiming).initiatorType,
          duration: Math.round(entry.duration * 100) / 100,
          transferSize: (entry as PerformanceResourceTiming).transferSize
        }))
      return {
        url: location.href,
        title: document.title,
        navigation: nav
          ? {
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
              load: Math.round(nav.loadEventEnd),
              responseStart: Math.round(nav.responseStart),
              duration: Math.round(nav.duration)
            }
          : null,
        resourceCount: resources.length,
        resources
      }
    })
    return JSON.stringify(data, null, 2).slice(0, 40_000)
  }
}
