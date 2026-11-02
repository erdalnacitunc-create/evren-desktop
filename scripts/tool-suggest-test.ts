/// <reference types="node" />
import { editDistance, suggestTool, unknownToolMessage } from '../src/main/agent/toolSuggest'

/**
 * Yanlış araç adı önerisi testleri.
 * Çalıştırma: node scripts/run-unit.cjs scripts/tool-suggest-test.ts
 *
 * Canlı koşuda gözlendi: model `run_code` çağırdı, doğrusu `execute` idi ve
 * hata mesajı bunu söylemediği için bir adım kaybedildi.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const TOOLS = [
  'execute',
  'run_command',
  'run_python',
  'read_file',
  'write_file',
  'edit_file',
  'list_files',
  'glob',
  'grep',
  'web_fetch',
  'todo_write',
  'usb_devices',
  'adb_devices',
  'task_status'
]

// ============ 1) Canlı koşudaki gerçek hata ============
{
  check('run_code → execute', suggestTool('run_code', TOOLS), 'execute')
  check('execute_code → execute', suggestTool('execute_code', TOOLS), 'execute')
  check('code → execute', suggestTool('code', TOOLS), 'execute')
  const message = unknownToolMessage('run_code', TOOLS)
  check('mesaj öneriyi içeriyor', message.includes('execute'), true)
  check('mesaj aracı adlandırıyor', message.includes('run_code'), true)
}

// ============ 2) Sık yabancı adlar ============
{
  check('bash → run_command', suggestTool('bash', TOOLS), 'run_command')
  check('shell → run_command', suggestTool('shell', TOOLS), 'run_command')
  check('terminal → run_command', suggestTool('terminal', TOOLS), 'run_command')
  check('read → read_file', suggestTool('read', TOOLS), 'read_file')
  check('write → write_file', suggestTool('write', TOOLS), 'write_file')
  check('edit → edit_file', suggestTool('edit', TOOLS), 'edit_file')
  check('ls → list_files', suggestTool('ls', TOOLS), 'list_files')
  check('search → grep', suggestTool('search', TOOLS), 'grep')
  check('todo → todo_write', suggestTool('todo', TOOLS), 'todo_write')
  check('python → run_python', suggestTool('python', TOOLS), 'run_python')
}

// ============ 3) Takma ad hedefi yoksa önerilmez ============
{
  // browser araç listesinde yok: "browse" için uydurmamalı.
  check('browse hedefi yok', suggestTool('browse', ['read_file']), null)
  // alias var ama hedef mevcut değil → mesafe/önek denenir, uzağı seçmez
  check('bash hedefsiz', suggestTool('bash', ['read_file', 'write_file']), null)
}

// ============ 4) Normalize eşleşme ============
{
  check('Read_File → read_file', suggestTool('Read_File', TOOLS), 'read_file')
  check('READ-FILE → read_file', suggestTool('READ-FILE', TOOLS), 'read_file')
  check('writeFile → write_file', suggestTool('writeFile', TOOLS), 'write_file')
  check('ListFiles → list_files', suggestTool('ListFiles', TOOLS), 'list_files')
}

// ============ 5) Yazım hatası ============
{
  check('run_comand → run_command', suggestTool('run_comand', TOOLS), 'run_command')
  check('grop → grep', suggestTool('grep2', TOOLS), 'grep')
  check('glob_ → glob', suggestTool('globb', TOOLS), 'glob')
}

// ============ 6) Uzak ad önerilmez ============
{
  check('tamamen alakasız → null', suggestTool('kubernetes_pod', TOOLS), null)
  check('tek harf → null', suggestTool('x', TOOLS), null)
  check('boş ad → null', suggestTool('', TOOLS), null)
  check('araç listesi boş → null', suggestTool('read_file', []), null)
}

// ============ 7) Sıra: takma ad öne çıkar ============
{
  // "code", "execute" alias'ı ile eşleşir; mesafe ile "execute" de seçilirdi.
  check('code alias öncelikli', suggestTool('code', ['execute_code', 'execute']), 'execute')
  check('birebir normalize alias\'tan önce', suggestTool('read_file', TOOLS), 'read_file')
}

// ============ 8) Mesafe fonksiyonu ============
{
  check('aynı metin', editDistance('abc', 'abc'), 0)
  check('tek ekleme', editDistance('abc', 'abcd'), 1)
  check('tek silme', editDistance('abcd', 'abc'), 1)
  check('tek değişim', editDistance('abc', 'abd'), 1)
  check('boş sol', editDistance('', 'abc'), 3)
  check('boş sağ', editDistance('abc', ''), 3)
  check('kitten/sitting', editDistance('kitten', 'sitting'), 3)
}

// ============ 9) Mesaj biçimi ============
{
  const withSuggestion = unknownToolMessage('run_code', TOOLS)
  check('öneri cümlesi', withSuggestion, 'Bilinmeyen araç: run_code. Bunu mu demek istediniz: execute? Aynı işi execute ile tekrar deneyin.')

  const withoutSuggestion = unknownToolMessage('kubernetes_pod', TOOLS)
  check(
    'öneri yoksa sade',
    withoutSuggestion,
    'Bilinmeyen araç: kubernetes_pod. Kullanılabilir araç listesinden birini seç.'
  )
  check('öneri yoksa "mu demek" yok', withoutSuggestion.includes('demek istediniz'), false)
}

// ============ 10) Determinist ============
{
  const first = suggestTool('run_code', TOOLS)
  const second = suggestTool('run_code', TOOLS)
  check('aynı girdi aynı çıktı', first, second)
}

console.log(`TOTAL=42 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
