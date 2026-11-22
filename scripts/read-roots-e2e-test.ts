/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  globWorkspace,
  grepWorkspace,
  readWorkspaceFile,
  resolveReadTarget,
  runWithReadRoots,
  runWithWorkspace,
  writeWorkspaceFile
} from '../src/main/workspace'

/**
 * Ek okuma kökleri — gerçek dosya sistemi (0.4.25).
 * Çalıştırma: node scripts/run-unit.cjs scripts/read-roots-e2e-test.ts
 *
 * ## Doğrulanan sözleşme
 *
 * 1. Kullanıcının verdiği kök **okunabilir** (mutlak yol, `read_file`/`glob`/`grep`).
 * 2. Kök dışındaki yol hâlâ **reddedilir**.
 * 3. **Yazma** hiçbir koşulda açılmaz — ek kök yalnızca okuma içindir.
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
async function rejects(label: string, run: () => Promise<unknown>): Promise<void> {
  total += 1
  try {
    await run()
    failed += 1
    console.log(`FAIL  ${label} — hata beklendi, çağrı başarılı oldu`)
  } catch {
    console.log(`PASS  ${label}`)
  }
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'read-roots')
  rmSync(base, { recursive: true, force: true })
  const workspace = join(base, 'workspace')
  const outside = join(base, 'outside')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(outside, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'ic.ts'), 'const ic = 1\n', 'utf8')
  writeFileSync(join(outside, 'src', 'dis.ts'), 'merhaba dünya\n', 'utf8')
  writeFileSync(join(outside, 'readme.md'), '# dış proje\n', 'utf8')

  // ============ 1) Kök yokken dışarısı kapalı ============
  {
    await runWithWorkspace(workspace, async () => {
      await rejects('kök yokken dış dosya reddedilir', () =>
        readWorkspaceFile(join(outside, 'readme.md'))
      )
    })
  }

  // ============ 2) Kök varken okuma açılır ============
  {
    await runWithWorkspace(workspace, () =>
      runWithReadRoots([outside], async () => {
        const file = await readWorkspaceFile(join(outside, 'readme.md'))
        check('dış dosya okunur', file.content.trim(), '# dış proje')
        check('etiket mutlak yol', file.path, join(outside, 'readme.md'))

        const rel = await readWorkspaceFile('src/ic.ts')
        check('çalışma alanı göreli okuma bozulmadı', rel.content.trim(), 'const ic = 1')

        const target = await resolveReadTarget(join(outside, 'src', 'dis.ts'))
        check('dış yol dış sayılır', target.outside, true)
      })
    )
  }

  // ============ 3) Kök dışındaki yol yine reddedilir ============
  {
    await runWithWorkspace(workspace, () =>
      runWithReadRoots([outside], async () => {
        await rejects('kök dışındaki üst dizin reddedilir', () =>
          readWorkspaceFile(join(base, 'gizli.txt'))
        )
      })
    )
  }

  // ============ 4) Yazma kapalı kalır ============
  {
    await runWithWorkspace(workspace, () =>
      runWithReadRoots([outside], async () => {
        await rejects('dış köke yazma reddedilir', () =>
          writeWorkspaceFile(join(outside, 'readme.md'), 'ele geçirildi')
        )
      })
    )
  }

  // ============ 5) glob / grep dış kökte çalışır ============
  {
    await runWithWorkspace(workspace, () =>
      runWithReadRoots([outside], async () => {
        const globbed = await globWorkspace('**/*.ts', outside)
        check('glob dış kökte buldu', globbed.some((p) => p.endsWith('dis.ts')), true)
        check('glob mutlak yol döndürür', globbed.every((p) => p.startsWith(outside)), true)

        const hits = await grepWorkspace('merhaba', outside)
        check('grep dış kökte buldu', hits.length, 1)
        check('grep mutlak yolla etiketler', hits[0]?.startsWith(join(outside, 'src', 'dis.ts')), true)
      })
    )
  }

  // ============ 6) Kökler bağlam dışına sızmaz ============
  {
    await runWithWorkspace(workspace, async () => {
      await rejects('kapsam dışında kök yok', () =>
        readWorkspaceFile(join(outside, 'readme.md'))
      )
    })
  }

  console.log(`TOTAL=${total} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
