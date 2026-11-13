/// <reference types="node" />
import { app } from 'electron'
import { createTools } from '../src/main/agent/tools'
import type { ChatEvent } from '../src/shared/types'

/**
 * Web araçlarının alt ajan bağlamında çalıştığını doğrular.
 * Çalıştırma: node scripts/run-unit.cjs scripts/web-tools-probe-test.ts
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

app.whenReady().then(async () => {
  // Alt ajanın kullandığı yapılandırmanın aynısı: browser/computer kapalı,
  // workspace yok, readOnly true.
  const registry = createTools({
    browser: false,
    computer: false,
    workspace: undefined,
    readOnly: true
  })

  const names = registry.names()
  console.log('araç sayısı:', names.length)
  console.log('websearch var:', names.includes('websearch'))
  console.log('webfetch var:', names.includes('webfetch'))
  console.log('browser var:', names.includes('browser'))

  const websearch = registry.get('websearch')
  const webfetch = registry.get('webfetch')

  const sink = (event: ChatEvent): void => {
    if (event.type !== 'tool-result') return
    console.log('  olay:', event.type)
  }
  const ctx = {
    requestId: 'probe',
    send: sink,
    signal: new AbortController().signal
  }

  if (websearch) {
    console.log('\n--- websearch: "Electron utilityProcess" ---')
    const started = Date.now()
    const result = await websearch.execute({ query: 'Electron utilityProcess documentation', max_results: 5 }, ctx)
    console.log('ok:', result.ok, '| süre:', Date.now() - started, 'ms')
    console.log('içerik (ilk 700):')
    console.log(result.content.slice(0, 700))
  }

  if (webfetch) {
    console.log('\n--- webfetch: example.com ---')
    const started = Date.now()
    const result = await webfetch.execute({ url: 'https://example.com' }, ctx)
    console.log('ok:', result.ok, '| süre:', Date.now() - started, 'ms')
    console.log('içerik (ilk 400):')
    console.log(result.content.slice(0, 400))
  }

  app.exit(0)
})
