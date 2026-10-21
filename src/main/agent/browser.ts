import { chromium, type Browser, type Page } from 'playwright-core'

const INTERACTIVE_SELECTOR =
  'a,button,input,textarea,select,[role="button"],[contenteditable="true"]'

export class BrowserSession {
  private browser: Browser | null = null
  private page: Page | null = null

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
}
