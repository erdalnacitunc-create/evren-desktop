import { app } from 'electron'
import { join } from 'path'
import { allowedRendererRoots, evaluateSender } from '../src/main/ipcGuard'

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

const rendererIndex = join(__dirname, '..', '..', '..', '..', 'out', 'renderer', 'index.html')

interface TestFrame {
  url: string
  parent: TestFrame | null
}

function frame(url: string, parent: TestFrame | null = null): TestFrame {
  return { url, parent }
}

function evt(
  url: string,
  opts: { parent?: TestFrame | null; mainFrame?: TestFrame | null; destroyed?: boolean } = {}
) {
  const f = frame(url, opts.parent ?? null)
  return {
    senderFrame: f,
    sender: {
      isDestroyed: () => opts.destroyed === true,
      mainFrame: opts.mainFrame ?? undefined
    }
  }
}

app.whenReady().then(async () => {
  const results: Array<[string, boolean, string]> = []
  const check = (label: string, verdict: { ok: boolean; reason?: string; origin?: string }, expected: boolean) => {
    results.push([label, verdict.ok === expected, verdict.ok ? `allow ${verdict.origin}` : `deny ${verdict.reason}`])
  }

  const rendererRoot = allowedRendererRoots().find((root) => root.includes('renderer')) ?? allowedRendererRoots()[0]
  const goodFile = 'file:///' + rendererRoot.replace(/\\/g, '/') + '/index.html'
  const badFile = 'file:///C:/Windows/System32/drivers/etc/hosts'

  check('file: renderer index', evaluateSender(evt(goodFile), 'test'), true)
  check('file: outside renderer', evaluateSender(evt(badFile), 'test'), false)
  check('file: renderer sibling dir', evaluateSender(evt('file:///' + rendererRoot.replace(/\\/g, '/') + '-evil/x.html'), 'test'), false)
  check('https: foreign origin', evaluateSender(evt('https://evil.example/x'), 'test'), false)
  check('about:srcdoc', evaluateSender(evt('about:srcdoc'), 'test'), false)
  check('about:blank', evaluateSender(evt('about:blank'), 'test'), false)
  check('devtools:', evaluateSender(evt('devtools://devtools/bundled/x.html'), 'test'), false)

  const main = frame(goodFile)
  check(
    'subframe',
    evaluateSender({ senderFrame: frame(goodFile, main), sender: { isDestroyed: () => false, mainFrame: main } }, 'test'),
    false
  )
  check('destroyed sender', evaluateSender(evt(goodFile, { destroyed: true }), 'test'), false)
  check('missing frame', evaluateSender({ senderFrame: null, sender: { isDestroyed: () => false } }, 'test'), false)

  process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
  check('dev origin allowed', evaluateSender(evt('http://localhost:5173/index.html'), 'test'), true)
  check('dev other port', evaluateSender(evt('http://localhost:5174/index.html'), 'test'), false)
  check('dev 127.0.0.1 mismatch', evaluateSender(evt('http://127.0.0.1:5173/index.html'), 'test'), false)
  delete process.env['ELECTRON_RENDERER_URL']
  check('dev origin when unset', evaluateSender(evt('http://localhost:5173/index.html'), 'test'), false)

  let failed = 0
  for (const [label, ok, detail] of results) {
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
  }
  console.log(`TOTAL=${results.length} FAILED=${failed}`)
  app.quit()
}).catch((error) => {
  console.error('GUARD_TEST_ERROR=' + (error instanceof Error ? error.stack : String(error)))
  app.exit(1)
})
