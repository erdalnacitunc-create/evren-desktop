/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createTools } from '../src/main/agent/tools'
import { runWithWorkspace } from '../src/main/workspace'
import type { ChatEvent } from '../src/shared/types'

/**
 * Dosya sahipliğinin araç düzeyinde zorlandığını doğrular.
 * Çalıştırma: node scripts/run-unit.cjs scripts/file-ownership-enforce-test.ts
 *
 * ## İddia
 *
 * Yazma izni listesi verilen ajan, liste dışına **yazamaz**. Bu istem kuralı
 * değil, kod garantisi: model unutsa bile değişiklik kaybolmaz.
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

const send = (_event: ChatEvent): void => undefined
const ctx = { requestId: 'own-probe', send, signal: new AbortController().signal }

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'ownership')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'src', 'auth'), { recursive: true })
  mkdirSync(join(base, 'src', 'billing'), { recursive: true })
  writeFileSync(join(base, 'src', 'auth', 'login.ts'), 'export const a = 1\n', 'utf8')
  writeFileSync(join(base, 'src', 'billing', 'pay.ts'), 'export const b = 1\n', 'utf8')

  await runWithWorkspace(base, async () => {
    // ===== Ajan yalnızca src/auth/ sahibi =====
    const registry = createTools({
      browser: false,
      computer: false,
      workspace: { root: base },
      allowedWritePaths: ['src/auth/']
    })

    const write = registry.get('write_file')
    const edit = registry.get('edit_file')
    check('write_file var', Boolean(write), true)
    check('edit_file var', Boolean(edit), true)

    // --- izinli yol ---
    const allowed = await write!.execute(
      { path: 'src/auth/yeni.ts', content: 'export const y = 1\n' },
      ctx
    )
    check('izinli yola yazabildi', allowed.ok, true)
    check(
      'dosya gerçekten oluştu',
      readFileSync(join(base, 'src', 'auth', 'yeni.ts'), 'utf8').includes('y = 1'),
      true
    )

    // --- yasak yol ---
    let blocked = ''
    try {
      await write!.execute({ path: 'src/billing/pay.ts', content: 'hack\n' }, ctx)
    } catch (error) {
      blocked = error instanceof Error ? error.message : String(error)
    }
    check('yasak yola yazma reddedildi', blocked.length > 0, true)
    check('hata yolu gösteriyor', blocked.includes('src/billing/pay.ts'), true)
    check('hata izni gösteriyor', blocked.includes('src/auth/'), true)
    check(
      'yasak dosya değişmedi',
      readFileSync(join(base, 'src', 'billing', 'pay.ts'), 'utf8').includes('hack'),
      false
    )

    // --- yasak yolu düzenleme ---
    let editBlocked = ''
    try {
      await edit!.execute(
        { path: 'src/billing/pay.ts', old_string: 'b = 1', new_string: 'b = 2' },
        ctx
      )
    } catch (error) {
      editBlocked = error instanceof Error ? error.message : String(error)
    }
    check('yasak yolu düzenleme reddedildi', editBlocked.length > 0, true)

    // --- yasak yolu silme ---
    const del = registry.get('delete_file')
    let delBlocked = ''
    try {
      await del!.execute({ path: 'src/billing/pay.ts' }, ctx)
    } catch (error) {
      delBlocked = error instanceof Error ? error.message : String(error)
    }
    check('yasak yolu silme reddedildi', delBlocked.length > 0, true)
    check(
      'silinmedi',
      readFileSync(join(base, 'src', 'billing', 'pay.ts'), 'utf8').includes('b = 1'),
      true
    )

    // ===== Kısıtsız ajan her yere yazabilir =====
    const free = createTools({ browser: false, computer: false, workspace: { root: base } })
    const freeWrite = free.get('write_file')!
    const unlimited = await freeWrite.execute(
      { path: 'src/billing/serbest.ts', content: 'export const s = 1\n' },
      ctx
    )
    check('kısıtsız ajan yazabildi', unlimited.ok, true)
  })

  console.log(`TOTAL=14 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
