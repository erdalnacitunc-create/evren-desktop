/// <reference types="node" />
import type { PermissionRule } from '../src/shared/types'
import {
  matchesPermissionPattern,
  permissionResource,
  resolvePermission,
  selectPermissionRule
} from '../src/shared/permissions'

/**
 * Kural tabanlı izin testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/permission-test.ts
 */

let failed = 0

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`)
}

const rule = (
  category: PermissionRule['category'],
  resource: string,
  effect: PermissionRule['effect']
): PermissionRule => ({ id: `${category}:${resource}`, category, resource, effect })

// --- desen eşleştirme ---
check('tam eşleşme', matchesPermissionPattern('npm test', 'npm test'), true)
check('joker son ek', matchesPermissionPattern('git push*', 'git push --force'), true)
check('joker uyuşmazlığı', matchesPermissionPattern('git push*', 'git pull'), false)
check('tek karakter ?', matchesPermissionPattern('npm run ?', 'npm run t'), true)
check('tek karakter fazla', matchesPermissionPattern('npm run ?', 'npm run test'), false)
check('yıldız her şey', matchesPermissionPattern('*', 'herhangi bir komut'), true)
check('büyük/küçük harf', matchesPermissionPattern('GIT PUSH*', 'git push'), true)
check('boş desen', matchesPermissionPattern('   ', 'x'), false)
check('regex meta karakterleri', matchesPermissionPattern('a.b', 'axb'), false)
check('yol deseni', matchesPermissionPattern('src/**', 'src/main/ipc.ts'), true)

// --- kural seçimi ---
const rules: PermissionRule[] = [
  rule('execute', '*', 'allow'),
  rule('execute', 'git push*', 'ask'),
  rule('execute', 'git push --force*', 'deny'),
  rule('edit', 'src/**', 'ask')
]

check('en özel desen kazanır', selectPermissionRule(rules, 'execute', 'git push --force'), 'deny')
check('orta özel desen', selectPermissionRule(rules, 'execute', 'git push'), 'ask')
check('genel desen', selectPermissionRule(rules, 'execute', 'npm test'), 'allow')
check('kategori ayrımı', selectPermissionRule(rules, 'read', 'src/main/ipc.ts'), null)
check('yol kuralı', selectPermissionRule(rules, 'edit', 'src/main/ipc.ts'), 'ask')
check('kural yok', selectPermissionRule(undefined, 'execute', 'x'), null)
check('boş kaynak', selectPermissionRule(rules, 'execute', ''), null)

// --- çözümleme ---
const settings = { execute: 'deny' as const, rules }
check('kural kategoriyi ezer', resolvePermission(settings, 'auto', 'build', 'execute', 'npm test'), 'allow')
check('kural yoksa kategori', resolvePermission({ execute: 'deny' }, 'auto', 'build', 'execute', 'npm test'), 'deny')
check('plan modu kuralı yok sayar', resolvePermission(settings, 'auto', 'plan', 'execute', 'npm test'), 'deny')
check('plan modu düzenlemeyi engeller', resolvePermission({ edit: 'allow' }, 'auto', 'plan', 'edit', 'src/a.ts'), 'deny')
check('plan modu okumaya dokunmaz', resolvePermission({}, 'auto', 'plan', 'read', 'src/a.ts'), 'allow')
check('onaylı mod varsayılanı', resolvePermission({}, 'confirm', 'build', 'read', 'x'), 'ask')
check('otomatik mod varsayılanı', resolvePermission({}, 'auto', 'build', 'read', 'x'), 'allow')

// --- kaynak çıkarımı ---
check('run_command kaynağı', permissionResource('run_command', { command: 'ls -la' }), 'ls -la')
check('write_file kaynağı', permissionResource('write_file', { path: 'src/a.ts' }), 'src/a.ts')
check('git kaynağı', permissionResource('git', { action: 'push' }), 'git push')
check('webfetch kaynağı', permissionResource('webfetch', { url: 'https://a.b/c' }), 'https://a.b/c')
check('mcp kaynağı', permissionResource('mcp_server_run', {}), 'mcp_server_run')
check('bilinmeyen araç', permissionResource('todo_write', { items: [] }), '')
check('boşluk kırpma', permissionResource('run_command', { command: '  ls  ' }), 'ls')

console.log(`TOTAL=${31} FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
