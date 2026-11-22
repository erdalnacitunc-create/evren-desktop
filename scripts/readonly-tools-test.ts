/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTools } from '../src/main/agent/tools'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * Salt-okunur ajanın yazma kaçışları (0.4.24).
 * Çalıştırma: node scripts/run-unit.cjs scripts/readonly-tools-test.ts
 *
 * ## Neden
 *
 * `explore` ve `review` ajanları "salt-okunur" sayılıyordu ama iki kapı açık
 * kalmıştı:
 *
 * 1. `patch` araç listesinde engellenmiyordu → doğrudan dosya yazabiliyordu.
 * 2. `execute` (Code Mode) içinden `tools.write_file(...)` çağrılabiliyordu;
 *    üst düzey araç filtresi bunu görmüyordu.
 *
 * Bu, 0.4.24'te kapatmaya çalıştığımız kusur sınıfının (sessiz kaçış) araç
 * düzeyindeki karşılığı. Test, kapının gerçekten kapalı olduğunu doğrular.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
mkdirSync(join(dataDir, 'logs'), { recursive: true })
app.setPath('userData', dataDir)

let failed = 0
let total = 0
function check(label: string, actual: unknown, expected: unknown): void {
  total += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'readonly-tools')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'a.txt'), 'ilk\n', 'utf8')

  const blocked = [
    'write_file',
    'edit_file',
    'patch',
    'delete_file',
    'create_directory',
    'run_command',
    'run_checks',
    'run_python',
    'git',
    'execute'
  ]
  const allowed = ['read_file', 'list_files', 'glob', 'grep', 'todo_write']

  await runWithWorkspace(base, async () => {
    // ============ 1) Salt-okunur araç listesi ============
    const readOnly = createTools({
      browser: false,
      computer: false,
      skills: [],
      workspace: { root: base },
      readOnly: true
    })
    const names = readOnly.names()
    for (const name of blocked) {
      check(`salt-okunur listede yok: ${name}`, names.includes(name), false)
    }
    for (const name of allowed) {
      check(`salt-okunur listede var: ${name}`, names.includes(name), true)
    }
    check('salt-okunur ajan write_file çağıramaz', readOnly.get('write_file'), undefined)
    check('salt-okunur ajan execute çağıramaz', readOnly.get('execute'), undefined)
    await readOnly.dispose()

    // ============ 2) Yazabilen ajan bu araçlara sahip ============
    const writable = createTools({
      browser: false,
      computer: false,
      skills: [],
      workspace: { root: base },
      readOnly: false
    })
    const writableNames = writable.names()
    for (const name of ['write_file', 'edit_file', 'patch', 'execute']) {
      check(`yazan ajan listede var: ${name}`, writableNames.includes(name), true)
    }
    await writable.dispose()

    // ============ 3) Code Mode yazan ajanda çalışmaya devam eder ============
    // `execute` salt-okunur ajanda hiç yok; yazabilen ajanda iç API'den
    // `write_file` çağrılabilir olmalı (aksi hâlde Code Mode işe yaramaz).
    const sandboxOwner = createTools({
      browser: false,
      computer: false,
      skills: [],
      workspace: { root: base },
      readOnly: false
    })
    const execute = sandboxOwner.get('execute')
    check('yazan ajan execute tanımlı', Boolean(execute), true)
    if (execute) {
      const script =
        'const r = await tools.write_file({ path: "code-mode.txt", content: "x" }); return r.ok;'
      const write = await execute.execute(
        { script },
        { requestId: 'test', send: () => undefined }
      )
      check('Code Mode yazma çalıştı (yazan ajan)', write.ok, true)
    }
    await sandboxOwner.dispose()
  })

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
