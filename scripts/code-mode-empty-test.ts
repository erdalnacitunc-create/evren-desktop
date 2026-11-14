/// <reference types="node" />
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTools } from '../src/main/agent/tools'
import { runWithWorkspace } from '../src/main/workspace'

/**
 * Code Mode (`execute`) boş sonuç denetimi.
 * Çalıştırma: node scripts/run-unit.cjs scripts/code-mode-empty-test.ts
 *
 * ## Canlı kusur (0.4.15, gemma-4-31b)
 *
 * Script `tools.run_command(...)` sonucundan `content.stdout` okudu; gerçek
 * alan `content` olduğundan tüm değerler `undefined` kaldı, `JSON.stringify`
 * `{}` üretti ve araç **`ok: true`** dedi. Model 11 dosyayı okuduğunu sandı,
 * oysa hiçbirini okumamıştı; raporu dosya adlarından yazdı ve "dosya erişim
 * kısıtları yaşandı" diye yanlış gerekçe verdi.
 *
 * Bu test boş sonucun artık **hata** olarak döndüğünü ve modeli doğru alana
 * yönlendirdiğini sabitler.
 */

const dataDir = process.env.EVREN_TEST_DATA as string
app.setPath('userData', dataDir)

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const ctx = {
  requestId: 'code-mode-probe',
  send: () => undefined,
  signal: new AbortController().signal
}

app.whenReady().then(async () => {
  const base = join(dataDir, 'code-mode')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'ornek.txt'), 'satir bir\nsatir iki\n', 'utf8')

  await runWithWorkspace(base, async () => {
    const registry = createTools({ browser: false, computer: false, workspace: { root: base } })
    const execute = registry.get('execute')!
    check('execute aracı var', Boolean(execute), true)

    // ===== 1) return yok → hata =====
    {
      const result = await execute.execute(
        { script: 'const r = await tools.run_command({command:"Get-Content ornek.txt"});' },
        ctx
      )
      check('return yoksa başarısız', result.ok, false)
      check('hata "boş sonuç" diyor', String(result.content).includes('boş sonuç'), true)
      check('return ipucu var', String(result.content).includes('return'), true)
    }

    // ===== 2) yanlış alan (`.stdout`) → {} → hata =====
    {
      const result = await execute.execute(
        {
          script:
            'const files = ["ornek.txt"];\n' +
            'const out = {};\n' +
            'for (const f of files) {\n' +
            '  const r = await tools.run_command({command:`Get-Content ${f}`});\n' +
            '  out[f] = r.stdout;\n' +
            '}\n' +
            'return out;'
        },
        ctx
      )
      check('yanlış alan başarısız', result.ok, false)
      check('alan adı ipucu var', String(result.content).includes('content'), true)
      check('stdout uyarısı', String(result.content).includes('stdout'), true)
    }

    // ===== 3) boş dizi → hata =====
    {
      const result = await execute.execute({ script: 'return []' }, ctx)
      check('boş dizi başarısız', result.ok, false)
    }

    // ===== 4) boş metin → hata =====
    {
      const result = await execute.execute({ script: 'return "   "' }, ctx)
      check('boş metin başarısız', result.ok, false)
    }

    // ===== 5) null → hata =====
    {
      const result = await execute.execute({ script: 'return null' }, ctx)
      check('null başarısız', result.ok, false)
    }

    // ===== 6) DOĞRU kullanım → başarılı ve içerik dönüyor =====
    {
      const result = await execute.execute(
        {
          script:
            'const r = await tools.run_command({command:"Get-Content ornek.txt"});\n' +
            'return r.content;'
        },
        ctx
      )
      check('doğru kullanım başarılı', result.ok, true)
      check('dosya içeriği geldi', String(result.content).includes('satir iki'), true)
    }

    // ===== 7) dolu nesne → başarılı =====
    {
      const result = await execute.execute(
        { script: 'return { a: 1, b: "iki" }' },
        ctx
      )
      check('dolu nesne başarılı', result.ok, true)
      check('nesne serileşti', String(result.content).includes('"a": 1'), true)
    }

    // ===== 8) dolu dizi → başarılı =====
    {
      const result = await execute.execute({ script: 'return [1,2,3]' }, ctx)
      check('dolu dizi başarılı', result.ok, true)
    }

    // ===== 9) hata mesajı hâlâ çalışıyor =====
    {
      const result = await execute.execute({ script: 'throw new Error("deneme")' }, ctx)
      check('script hatası yakalandı', result.ok, false)
      check('hata metni', String(result.content).includes('deneme'), true)
    }
  })

  console.log(`TOTAL=17 FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
