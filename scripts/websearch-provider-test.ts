/// <reference types="node" />
import { app } from 'electron'
import { createTools } from '../src/main/agent/tools'
import { providerOrder } from '../src/main/agent/websearch'

/**
 * Google CSE yapılandırmasının gerçekten etkin olup olmadığını ölçer.
 * Çalıştırma: node scripts/run-unit.cjs scripts/websearch-provider-test.ts
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

app.whenReady().then(async () => {
  const googleKey = process.env['GOOGLE_CSE_API_KEY']?.trim()
  const googleCx = process.env['GOOGLE_CSE_ID']?.trim()
  const forced = process.env['EVREN_WEBSEARCH_PROVIDER']?.trim()

  console.log('GOOGLE_CSE_API_KEY:', googleKey ? `var (${googleKey.length} kr)` : 'YOK')
  console.log('GOOGLE_CSE_ID:', googleCx ? `var (${googleCx.length} kr)` : 'YOK')
  console.log('EVREN_WEBSEARCH_PROVIDER:', forced ?? '(ayarlanmamış)')
  console.log('etkin zincir:', providerOrder({ googleKey, googleCx, forced }).join(' → '))

  const registry = createTools({ browser: false, computer: false, readOnly: true })
  const websearch = registry.get('websearch')
  if (!websearch) {
    console.log('HATA: websearch aracı yok')
    app.exit(1)
    return
  }

  const query = 'OpenSSL 3.5 release notes'
  console.log(`\n--- gerçek arama: "${query}" ---`)
  const result = await websearch.execute(
    { query, max_results: 5 },
    { requestId: 'probe', send: () => undefined, signal: new AbortController().signal }
  )
  console.log('ok:', result.ok)
  // İlk satır hangi sağlayıcının kullanıldığını söyler: "Arama (X): …"
  console.log('ilk satır:', result.content.split('\n')[0])
  console.log('sonuç sayısı:', (result.content.match(/^\d+\. /gm) ?? []).length)
  if (!result.ok) {
    console.log('\n--- tam hata ---')
    console.log(result.content)
  }

  // Google kullanıldı mı?
  const usedGoogle = /^Arama \(Google\)/.test(result.content)
  console.log('\nGoogle kullanıldı mı:', usedGoogle)
  if (!usedGoogle) {
    console.log('neden:', googleKey && googleCx ? 'Google denendi ama boş döndü' : 'anahtar yok')
  }

  app.exit(0)
})
