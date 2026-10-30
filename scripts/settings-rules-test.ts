/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getSettings } from '../src/main/settings'

/**
 * İzin kurallarının ayar dosyasından yüklenirken doğrulanmasını test eder.
 * Çalıştırma: node scripts/run-unit.cjs scripts/settings-rules-test.ts
 */

const dataDir = process.env.EVREN_TEST_DATA as string
app.setPath('userData', dataDir)
mkdirSync(dataDir, { recursive: true })

writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({
    baseUrl: 'https://example.invalid',
    permissions: {
      execute: 'allow',
      rules: [
        { id: 'r1', category: 'execute', resource: 'git push*', effect: 'ask' },
        { id: 'r2', category: 'gecersiz', resource: 'x', effect: 'deny' },
        { id: 'r3', category: 'edit', resource: '   ', effect: 'allow' },
        { id: 'r4', category: 'edit', resource: 'src/**', effect: 'allow', note: ' kısa not ' },
        { id: 'r5', category: 'read', resource: '*', effect: 'belirsiz' }
      ]
    }
  }),
  'utf8'
)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

app.whenReady().then(async () => {
  const settings = await getSettings()
  const rules = settings.permissions?.rules ?? []

  check('geçersiz kurallar atıldı', rules.map((rule) => rule.id), ['r1', 'r4'])
  check('desen korunur', rules[0]?.resource, 'git push*')
  check('kategori korunur', rules[1]?.category, 'edit')
  check('not kırpılır', rules[1]?.note, 'kısa not')
  check('kategori varsayılanı korunur', settings.permissions?.execute, 'allow')

  console.log(`TOTAL=5 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
