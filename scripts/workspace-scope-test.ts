/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  currentWorkspaceScope,
  getWorkspaceRoot,
  isTemporaryWorkspacePath,
  readWorkspaceFile,
  runWithWorkspace,
  setWorkspaceRootOverride,
  writeWorkspaceFile
} from '../src/main/workspace'

/**
 * Çalışma alanı kapsamı testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/workspace-scope-test.ts
 *
 * Süreç ayrımında bu kapsam payload'a serileşecek; burada her isteğin
 * yalnızca kendi kökünü gördüğünü ve paralel isteklerin karışmadığını
 * doğruluyoruz.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const base = join(process.env.EVREN_TEST_DATA as string, 'ws')
  const dirA = join(base, 'a')
  const dirB = join(base, 'b')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
  writeFileSync(join(dirA, 'only-a.txt'), 'A içeriği', 'utf8')
  writeFileSync(join(dirB, 'only-b.txt'), 'B içeriği', 'utf8')

  // --- temel kapsam ---
  check('kapsam dışında undefined', currentWorkspaceScope(), undefined)

  await runWithWorkspace(dirA, async () => {
    check('kapsam içinde kök A', await getWorkspaceRoot(), dirA)
    check('currentWorkspaceScope A', currentWorkspaceScope(), dirA)
  })

  check('kapsam bittikten sonra undefined', currentWorkspaceScope(), undefined)

  // --- null kapsam (workspace yok) ---
  await runWithWorkspace(null, async () => {
    check('null kapsam null döner', await getWorkspaceRoot(), null)
    check('null kapsam ayırt edilir', currentWorkspaceScope(), null)
  })

  // --- iç içe kapsam ---
  await runWithWorkspace(dirA, async () => {
    await runWithWorkspace(dirB, async () => {
      check('iç kapsam B', await getWorkspaceRoot(), dirB)
    })
    check('dış kapsam geri A', await getWorkspaceRoot(), dirA)
  })

  // --- paralel izolasyon (asıl senaryo) ---
  const results: string[] = []
  await Promise.all([
    runWithWorkspace(dirA, async () => {
      for (let index = 0; index < 5; index++) {
        await sleep(5)
        results.push(`A:${await getWorkspaceRoot()}`)
      }
    }),
    runWithWorkspace(dirB, async () => {
      for (let index = 0; index < 5; index++) {
        await sleep(3)
        results.push(`B:${await getWorkspaceRoot()}`)
      }
    })
  ])
  check('paralel A hep A görür', results.filter((item) => item === `A:${dirA}`).length, 5)
  check('paralel B hep B görür', results.filter((item) => item === `B:${dirB}`).length, 5)
  check('karışma yok', results.length, 10)

  // --- gerçek dosya erişimi kapsama uyar ---
  await runWithWorkspace(dirA, async () => {
    const read = await readWorkspaceFile('only-a.txt')
    check('A dosyası okunur', read.content, 'A içeriği')
    let failedRead = false
    try {
      await readWorkspaceFile('only-b.txt')
    } catch {
      failedRead = true
    }
    check('B dosyası A kapsamından okunamaz', failedRead, true)
  })

  await runWithWorkspace(dirB, async () => {
    const read = await readWorkspaceFile('only-b.txt')
    check('B dosyası okunur', read.content, 'B içeriği')
  })

  // --- yazma kapsama uyar ---
  await runWithWorkspace(dirA, async () => {
    await writeWorkspaceFile('yazildi.txt', 'içerik')
  })
  const written = await runWithWorkspace(dirA, () => readWorkspaceFile('yazildi.txt'))
  check('yazılan dosya A kökünde okunur', written.content, 'içerik')
  let visibleFromB = true
  try {
    await runWithWorkspace(dirB, () => readWorkspaceFile('yazildi.txt'))
  } catch {
    visibleFromB = false
  }
  check('yazılan dosya B kapsamından görünmez', visibleFromB, false)

  // --- override ---
  setWorkspaceRootOverride(dirB)
  check('override kapsam dışında geçerli', await getWorkspaceRoot(), dirB)
  await runWithWorkspace(dirA, async () => {
    check('kapsam override değerini ezer', await getWorkspaceRoot(), dirA)
  })
  setWorkspaceRootOverride(undefined)
  check('override kaldırılınca ayarlara döner', await getWorkspaceRoot(), null)

  // --- geçici yol tanıma ---
  check('geçici yol tanınır', isTemporaryWorkspacePath(join(app.getPath('temp'), 'evren-workspaces', 'x')), true)
  check('normal yol geçici değil', isTemporaryWorkspacePath(dirA), false)
  check('boş yol geçici değil', isTemporaryWorkspacePath(''), false)
  check('null yol geçici değil', isTemporaryWorkspacePath(null), false)

  console.log(`TOTAL=23 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
