import { promises as fs, existsSync } from 'fs'
import { execFile } from 'child_process'
import { join, relative, resolve } from 'path'
import { promisify } from 'util'
import type { CheckResult, ProjectCheck } from '../shared/types'
import { getWorkspaceRoot, runWorkspaceCommand } from './workspace'

const execFileAsync = promisify(execFile)

const CHECK_GROUPS: Array<{ id: string; label: string; keys: string[] }> = [
  { id: 'typecheck', label: 'Typecheck', keys: ['typecheck', 'type-check', 'tsc', 'check'] },
  { id: 'lint', label: 'Lint', keys: ['lint', 'eslint'] },
  { id: 'test', label: 'Test', keys: ['test', 'tests', 'vitest', 'jest'] },
  { id: 'build', label: 'Build', keys: ['build'] }
]

export async function detectProjectChecks(): Promise<ProjectCheck[]> {
  const root = await getWorkspaceRoot()
  if (!root) return []

  let scripts: Record<string, unknown> = {}
  try {
    const raw = await fs.readFile(join(root, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    scripts = parsed.scripts ?? {}
  } catch {
    scripts = {}
  }

  const checks: ProjectCheck[] = []
  for (const group of CHECK_GROUPS) {
    const key = group.keys.find((candidate) => typeof scripts[candidate] === 'string')
    if (!key) continue
    checks.push({
      id: group.id,
      label: group.label,
      script: key,
      command: `npm run ${key}`,
      available: true
    })
  }

  if (checks.length === 0) {
    try {
      await fs.access(join(root, 'tsconfig.json'))
      checks.push({
        id: 'typecheck',
        label: 'Typecheck',
        script: 'tsc --noEmit',
        command: 'npx tsc --noEmit',
        available: true
      })
    } catch {
      // tsconfig yok
    }
  }

  return checks
}

export async function runProjectChecks(names?: string[]): Promise<CheckResult[]> {
  const checks = await detectProjectChecks()
  const selected =
    names && names.length > 0
      ? checks.filter(
          (check) => names.includes(check.id) || names.includes(check.script)
        )
      : checks

  const results: CheckResult[] = []
  for (const check of selected) {
    const execution = await runWorkspaceCommand(check.command, 180_000)
    const output = [execution.stdout, execution.stderr]
      .filter((part) => part.trim())
      .join('\n')
      .slice(0, 20_000)
    results.push({
      id: check.id,
      label: check.label,
      command: check.command,
      ok: execution.exitCode === 0,
      exitCode: execution.exitCode,
      output: output || '(çıktı yok)'
    })
  }
  return results
}

export interface FormatResult {
  ok: boolean
  output: string
}

/**
 * Projede Prettier varsa tek dosyayı formatlar.
 * Prettier yoksa null döner (hook sessizce atlanır).
 */
export async function formatWorkspaceFile(relativePath: string): Promise<FormatResult | null> {
  const root = await getWorkspaceRoot()
  if (!root) return null
  const absolute = resolve(root, relativePath)
  const check = relative(root, absolute)
  if (check.startsWith('..') || resolve(root, check) !== absolute) {
    throw new Error('Format yolu çalışma alanı dışında.')
  }

  const candidates = [
    join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
    join(root, 'node_modules', 'prettier', 'bin', 'prettier.js'),
    join(root, 'node_modules', 'prettier', 'bin-prettier.js')
  ]
  const binary = candidates.find((candidate) => existsSync(candidate))
  if (!binary) return null

  try {
    const result = await execFileAsync(process.execPath, [binary, '--write', absolute], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    })
    return {
      ok: true,
      output: [String(result.stdout ?? ''), String(result.stderr ?? '')]
        .filter((part) => part.trim())
        .join('\n')
        .slice(0, 4000)
    }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      output: String(err.stderr ?? err.stdout ?? err.message ?? error).slice(0, 4000)
    }
  }
}
