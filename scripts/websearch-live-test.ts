/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { createTools } from '../src/main/agent/tools'
import { resetProviderMemory } from '../src/main/agent/websearch'

/**
 * `websearch` canlı sınaması (gerçek ağ).
 * Çalıştırma: node scripts/run-unit.cjs scripts/websearch-live-test.ts
 *
 * ## Neden
 *
 * 0.4.14 canlı koşusunda 15 aramanın **9'u başarısız**, 2'si alakasız sonuç
 * döndürdü ("Cleveland doğum hasarı avukatı"). Kök neden ölçüldü: DuckDuckGo
 * 202/captcha döndürüyor, Bing ise başka bir sorgunun sayfasını veriyor.
 *
 * Bu test onarımı gerçek ağda doğrular: en az bir sorgu geçerli ve **alakalı**
 * sonuç getirmeli, çöp sonuç kabul edilmemeli.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const QUERIES = [
  {
    query: 'esp8266 flasher esp32 standalone',
    expect: ['esp8266', 'esp32', 'flash'],
    label: 'ESP flasher'
  },
  {
    query: 'electron utilityProcess documentation',
    expect: ['electron', 'utilityprocess', 'process'],
    label: 'Electron'
  },
  {
    query: 'ripgrep search performance',
    expect: ['ripgrep', 'search', 'perform'],
    label: 'ripgrep'
  }
]

app.whenReady().then(async () => {
  mkdirSync(join(process.env.EVREN_TEST_DATA as string, 'ws'), { recursive: true })
  resetProviderMemory()

  const registry = createTools({ browser: false, computer: false })
  const tool = registry.get('websearch')
  check('websearch aracı var', Boolean(tool), true)

  const ctx = {
    requestId: 'ws-live',
    send: () => undefined,
    signal: new AbortController().signal
  }

  let successes = 0
  for (const item of QUERIES) {
    const started = Date.now()
    const result = await tool!.execute({ query: item.query }, ctx)
    const elapsed = Date.now() - started
    const text = String(result.content ?? '')
    const haystack = text.toLowerCase()
    const relevant = item.expect.some((token) => haystack.includes(token))
    const looksGarbage = /lidl|birth injury|cleveland|store finder/.test(haystack)

    console.log(
      `\n${item.label}: ok=${result.ok} ${elapsed}ms · ${text.split('\n').length} satır · ilgili=${relevant} · çöp=${looksGarbage}`
    )
    console.log(`  ${text.split('\n').slice(0, 4).join(' | ').slice(0, 220)}`)

    check(`${item.label}: başarılı`, result.ok, true)
    check(`${item.label}: ilgili sonuç`, relevant, true)
    check(`${item.label}: çöp yok`, looksGarbage, false)
    if (result.ok) successes += 1
  }

  check('en az 2 sorgu başarılı', successes >= 2, true)

  // Sağlayıcı hafızası: aynı süreçte ikinci arama daha hızlı olmalı.
  const second = await tool!.execute({ query: 'esp32 oled display u8g2' }, ctx)
  check('yedek arama da çalışır', second.ok, true)

  console.log(`\nTOTAL=14 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
