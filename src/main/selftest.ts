import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { runAgent } from './agent/loop'
import { createTools } from './agent/tools'
import { resolveApproval, waitForApproval } from './agent/approval'
import { captureScreen, runComputerCommand, toSendKeys } from './agent/computer'
import {
  inspectRepository,
  installFromGithub,
  loadEnabledSkills,
  removeInstalledExtension
} from './extensions'
import { connectMcp, disconnectMcp, getAgentMcpTools, listServerTools } from './mcp/manager'
import { CallbackServer } from './mcp/oauthProvider'
import { clearOAuthState, loadOAuthState, saveOAuthState } from './mcp/oauthStore'
import { compactSession } from './compaction/service'
import { listCommands } from './commands'
import { learnFromSession } from './memory/extract'
import { buildMemoryContext, retrieveMemories } from './memory/retrieve'
import { addMemory, deleteMemory, listMemories, setInstructions } from './memory/store'
import { callPluginTool, getAgentPluginTools, loadPlugin, unloadPlugin } from './plugins/manager'
import { runMultiverse } from './multiverse'
import { extensionsRoot, removeExtension, upsertExtension } from './extensions/store'
import { getQuota, listModels } from './api'
import { streamChat } from './chat'
import { apiKeySource, loadApiKey, saveApiKey } from './credentials'
import { getSettings, updateSettings } from './settings'
import {
  appendMessage,
  createSession,
  deleteSession,
  listSessions,
  searchSessions
} from './sessionStore'
import type { ChatEvent, InstalledExtension } from '../shared/types'

/**
 * Basiz (headless) duman/entegrasyon testi.
 * Anahtar ASLA yazdirilmaz; yalnizca ozet bilgi doner.
 */
export async function runSelfTest(): Promise<void> {
  const lines: string[] = []
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  lines.push(`encryption_available=${encryptionAvailable}`)

  if (encryptionAvailable) {
    try {
      const probe = safeStorage.encryptString('selftest-probe')
      lines.push(`dpapi_roundtrip=${safeStorage.decryptString(probe) === 'selftest-probe'}`)
    } catch (error) {
      lines.push(`dpapi_roundtrip=false (${error instanceof Error ? error.message : error})`)
    }
  }

  const key = await loadApiKey()
  lines.push(`key_present=${!!key} source=${apiKeySource() ?? 'none'}`)

  if (key) {
    const settings = await getSettings()
    lines.push(`base_url=${settings.baseUrl}`)
    try {
      const models = await listModels(settings.baseUrl, key)
      lines.push(`models=${models.length}`)
      lines.push(`model_ids=${models.map((m) => m.id).join(',')}`)

      const quota = await getQuota(settings.baseUrl, key)
      lines.push(
        `quota_level=${quota.level} daily_remaining=${quota.daily_remaining_tokens} remaining_cr=${quota.remaining_cr}`
      )

      if (process.env['EVREN_SEED'] === '1' && apiKeySource() === 'env' && encryptionAvailable) {
        await saveApiKey(key)
        lines.push('seeded=stored')
      }

      if (process.env['EVREN_SELFTEST_CHAT'] === '1') {
        const controller = new AbortController()
        let content = ''
        let reasoning = ''
        let finish: string | null = null
        let chatError: string | null = null

        await streamChat(
          'selftest-chat',
          settings.baseUrl,
          key,
          {
            model: 'deepseek-v4.1-flash',
            messages: [{ role: 'user', content: 'Tek kelimeyle merhaba de.' }],
            max_tokens: 120,
            temperature: 0.2,
            top_p: 0.9
          },
          controller,
          (event) => {
            if (event.type === 'content') content += event.text
            else if (event.type === 'reasoning') reasoning += event.text
            else if (event.type === 'done') finish = event.finishReason
            else if (event.type === 'error') chatError = event.error
          }
        )

        lines.push(
          `chat_content_len=${content.length} chat_reasoning_len=${reasoning.length} chat_finish=${finish ?? 'null'} chat_error=${chatError ?? 'none'}`
        )
        lines.push(`chat_sample=${JSON.stringify(content.slice(0, 100))}`)
      }

      if (process.env['EVREN_SELFTEST_SESSIONS'] === '1') {
        const created = await createSession('selftest-model')
        const marker = 'selftest-arama-anahtari'
        await appendMessage(created.id, {
          id: crypto.randomUUID(),
          role: 'user',
          content: marker,
          createdAt: Date.now()
        })
        const updated = await appendMessage(created.id, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'selftest yanit',
          reasoning: 'kisa dusunme',
          createdAt: Date.now(),
          finishReason: 'stop'
        })
        const found = await searchSessions(marker)
        const summaries = await listSessions()

        const storePath = join(app.getPath('userData'), 'sessions.json')
        let diskOk = false
        try {
          const raw = await fs.readFile(storePath, 'utf8')
          const parsed = JSON.parse(raw)
          diskOk = Array.isArray(parsed) && parsed.some((s) => s.id === created.id)
        } catch {
          diskOk = false
        }

        const deleted = await deleteSession(created.id)

        lines.push(
          `sessions_title_ok=${updated?.title === marker} messages=${updated?.messages.length ?? 0} ` +
            `search_hit=${found.some((s) => s.id === created.id)} list_has=${summaries.some(
              (s) => s.id === created.id
            )} disk_ok=${diskOk} deleted=${deleted}`
        )
      }

      if (process.env['EVREN_SELFTEST_SETTINGS'] === '1') {
        const before = await getSettings()
        const next = await updateSettings({
          temperature: 5,
          top_p: 0.5,
          max_tokens: 321,
          reasoning_effort: '  high  ',
          thinking: true
        })
        lines.push(
          `settings_temperature=${next.temperature} settings_top_p=${next.top_p} ` +
            `settings_max_tokens=${next.max_tokens} settings_effort=${JSON.stringify(
              next.reasoning_effort
            )} settings_thinking=${next.thinking} settings_base=${next.baseUrl}`
        )
        // Onceki ayarlara don
        await updateSettings({
          temperature: before.temperature,
          top_p: before.top_p,
          max_tokens: before.max_tokens,
          reasoning_effort: before.reasoning_effort,
          thinking: before.thinking
        })
      }

      if (process.env['EVREN_SELFTEST_AGENT'] === '1') {
        process.env['EVREN_BROWSER_HEADLESS'] = '1'
        const controller = new AbortController()
        const events: ChatEvent[] = []

        await runAgent({
          requestId: 'selftest-agent',
          webContentsId: 0,
          baseUrl: settings.baseUrl,
          apiKey: key,
          payload: {
            model: 'deepseek-v4.1-flash',
            messages: [
              {
                role: 'user',
                content:
                  'Tarayıcıda https://example.com adresini aç ve sayfanın başlığını söyle. Araçları kullan.'
              }
            ],
            max_tokens: 400,
            agent: { enabled: true, mode: 'auto', profile: 'build', browser: true, computer: false, workspace: false }
          },
          controller,
          send: (event) => events.push(event)
        })

        const toolCalls = events.filter(
          (event): event is Extract<ChatEvent, { type: 'tool-call' }> =>
            event.type === 'tool-call'
        )
        const toolResults = events.filter(
          (event): event is Extract<ChatEvent, { type: 'tool-result' }> =>
            event.type === 'tool-result'
        )
        const done = events.find(
          (event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done'
        )
        const agentError = events.find(
          (event): event is Extract<ChatEvent, { type: 'error' }> => event.type === 'error'
        )
        const content = events
          .filter((event): event is Extract<ChatEvent, { type: 'content' }> => event.type === 'content')
          .map((event) => event.text)
          .join('')

        lines.push(
          `agent_tool_calls=${toolCalls.length} agent_tool_results=${toolResults.length} ` +
            `agent_done=${done?.finishReason ?? 'none'} agent_error=${agentError?.error ?? 'none'}`
        )
        lines.push(`agent_tool_names=${toolCalls.map((event) => event.call.name).join(',')}`)
        lines.push(`agent_tool_ok=${toolResults.map((event) => event.result.ok).join(',')}`)
        lines.push(`agent_content=${JSON.stringify(content.slice(0, 200))}`)
      }

      if (process.env['EVREN_SELFTEST_COMPUTER'] === '1') {
        const shot = await captureScreen()
        lines.push(
          `computer_screenshot=${shot.width}x${shot.height} data_url_len=${shot.dataUrl.length}`
        )

        const cursor = await runComputerCommand({ cmd: 'cursor' })
        lines.push(`computer_cursor_ok=${cursor.ok} x=${cursor.x} y=${cursor.y}`)
        lines.push(`sendkeys_ctrl_s=${JSON.stringify(toSendKeys('CTRL+S'))}`)
        lines.push(`sendkeys_enter=${JSON.stringify(toSendKeys('ENTER'))}`)

        const approvalPromise = waitForApproval('selftest:approval', new AbortController())
        const resolved = resolveApproval('selftest:approval', true)
        const approved = await approvalPromise
        lines.push(`approval_resolved=${resolved} approved=${approved}`)
      }

      if (process.env['EVREN_SELFTEST_EXTENSIONS'] === '1') {
        const repoUrl = 'https://github.com/morluto/rea'
        const inspection = await inspectRepository(repoUrl)
        lines.push(
          `extensions_repo=${inspection.repo} commit=${inspection.commit.slice(0, 8)} units=${inspection.units.length}`
        )
        lines.push(
          `extensions_units=${inspection.units
            .map((unit) => `${unit.type}:${unit.name}`)
            .join(',')}`
        )

        const skillUnits = inspection.units.filter((unit) => unit.type === 'skill')
        const target =
          skillUnits.find(
            (unit) =>
              unit.path.includes('reverse-engineer-anything') ||
              unit.name.toLowerCase().includes('reverse')
          ) ?? skillUnits[0]

        if (target) {
          const installed = await installFromGithub(repoUrl, [target.id])
          lines.push(
            `extensions_installed=${installed.length} name=${installed[0]?.name ?? '-'} path=${installed[0]?.localPath ?? '-'}`
          )
          const skills = await loadEnabledSkills()
          lines.push(
            `extensions_loaded=${skills.length} loaded_name=${skills[0]?.name ?? '-'} content_len=${skills[0]?.content.length ?? 0}`
          )
          for (const extension of installed) {
            await removeInstalledExtension(extension.id)
          }
          lines.push('extensions_cleaned=1')
        } else {
          lines.push('extensions_installed=0 (beceri bulunamadi)')
        }

        const mcpUnit = inspection.units.find((unit) => unit.type === 'mcp')
        if (mcpUnit) {
          const installedMcp = await installFromGithub(repoUrl, [mcpUnit.id])
          const extension = installedMcp[0]
          lines.push(
            `mcp_installed=${installedMcp.length} name=${extension?.name ?? '-'} type=${extension?.config?.type ?? '-'}`
          )
          if (extension) {
            const status = await connectMcp(extension)
            lines.push(
              `mcp_state=${status.state} tools=${status.toolCount} error=${status.error ?? 'none'}`
            )
            const agentTools = await getAgentMcpTools()
            lines.push(
              `mcp_agent_tools=${agentTools.length} meta=${agentTools.filter((tool) => tool.meta).length} names=${agentTools.map((tool) => tool.name).join(',')}`
            )

            const registry = createTools({
              browser: false,
              computer: false,
              mcpTools: agentTools
            })
            const listTool = agentTools.length > 0 ? registry.get(agentTools[0].name) : undefined
            if (listTool) {
              const listResult = await listTool.execute(
                {},
                { requestId: 'selftest', send: () => undefined }
              )
              lines.push(
                `mcp_meta_list_ok=${listResult.ok} content_len=${listResult.content.length}`
              )
            }

            const describeTool = registry.get(
              agentTools.find((tool) => tool.meta === 'describe')?.name ?? ''
            )
            const serverTools = await listServerTools(extension.id)
            const sampleTool = serverTools[0]?.name
            if (describeTool && sampleTool) {
              const describeResult = await describeTool.execute(
                { tool: sampleTool },
                { requestId: 'selftest', send: () => undefined }
              )
              lines.push(
                `mcp_meta_describe_ok=${describeResult.ok} content_len=${describeResult.content.length}`
              )
            }
            await registry.dispose()

            await disconnectMcp(extension.id)
            await removeInstalledExtension(extension.id)
            lines.push('mcp_cleaned=1')
          }
        } else {
          lines.push('mcp_installed=0 (MCP bulunamadi)')
        }
      }

      if (process.env['EVREN_SELFTEST_MCP_HTTP'] === '1') {
        const remote: InstalledExtension = {
          id: 'mcp:selftest:remote',
          type: 'mcp',
          name: 'deepwiki',
          description: 'Uzak HTTP MCP testi',
          enabled: true,
          scope: 'global',
          source: {
            provider: 'github',
            repo: 'selftest/remote',
            url: 'https://mcp.deepwiki.com/mcp'
          },
          localPath: '',
          installedAt: Date.now(),
          updatedAt: Date.now(),
          config: { type: 'remote', url: 'https://mcp.deepwiki.com/mcp' }
        }
        const status = await connectMcp(remote)
        lines.push(
          `http_mcp_state=${status.state} tools=${status.toolCount} error=${status.error ?? 'none'}`
        )
        await disconnectMcp(remote.id)
      }

      if (process.env['EVREN_SELFTEST_OAUTH'] === '1') {
        await saveOAuthState('selftest', {
          tokens: { access_token: 'test-token' },
          codeVerifier: 'verifier-1'
        })
        const loaded = await loadOAuthState('selftest')
        lines.push(
          `oauth_store_token=${loaded.tokens?.access_token === 'test-token'} verifier=${loaded.codeVerifier === 'verifier-1'}`
        )
        await clearOAuthState('selftest')
        const cleared = await loadOAuthState('selftest')
        lines.push(`oauth_cleared=${!cleared.tokens && !cleared.codeVerifier}`)

        const callback = new CallbackServer()
        const redirect = await callback.start()
        callback.setState('state-123')
        const codePromise = callback.waitForCode(5_000)
        const response = await fetch(`${redirect}?code=abc123&state=state-123`)
        const body = await response.text()
        const code = await codePromise
        lines.push(`oauth_callback_code=${code} html_ok=${body.includes('tamamlandı')}`)
        await callback.close()
      }

      if (process.env['EVREN_SELFTEST_PLUGIN'] === '1') {
        const relativePath = 'plugins/selftest'.replace(/\\/g, '/')
        const directory = join(extensionsRoot(), relativePath)
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(
          join(directory, 'index.js'),
          [
            'module.exports = {',
            '  register(api) {',
            '    api.registerTool({',
            "      name: 'echo',",
            "      description: 'Echo testi',",
            "      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },",
            '      async execute(args) { return "echo:" + String(args.text) }',
            '    })',
            '    api.registerTool({',
            "      name: 'storage',",
            "      description: 'Storage testi',",
            "      inputSchema: { type: 'object', properties: {} },",
            '      async execute() {',
            "        await api.storage.set('key', 42)",
            "        const value = await api.storage.get('key')",
            '        return "stored:" + String(value)',
            '      }',
            '    })',
            '    api.registerTool({',
            "      name: 'blocked_require',",
            "      description: 'Sandbox testi',",
            "      inputSchema: { type: 'object', properties: {} },",
            '      async execute() {',
            "        try { require('node:fs'); return 'unexpected' }",
            "        catch (error) { return 'blocked:' + error.message }",
            '      }',
            '    })',
            '    api.registerTool({',
            "      name: 'denied_fetch',",
            "      description: 'Ag izni testi',",
            "      inputSchema: { type: 'object', properties: {} },",
            '      async execute() {',
            "        try { await api.fetch('https://not-allowed.example.org'); return 'unexpected' }",
            "        catch (error) { return 'denied:' + error.message }",
            '      }',
            '    })',
            '  }',
            '}'
          ].join('\n'),
          'utf8'
        )

        const extension: InstalledExtension = {
          id: 'plugin:selftest',
          type: 'plugin',
          name: 'selftest',
          description: 'E3 test eklentisi',
          enabled: true,
          scope: 'global',
          source: {
            provider: 'github',
            repo: 'selftest/plugin',
            url: 'https://github.com/selftest/plugin'
          },
          localPath: relativePath,
          installedAt: Date.now(),
          updatedAt: Date.now(),
          entry: 'index.js',
          permissions: { network: ['example.com'], filesystem: false, shell: false }
        }

        const status = await loadPlugin(extension)
        await upsertExtension(extension)
        const agentTools = await getAgentPluginTools()
        const echo = await callPluginTool(extension.id, 'echo', { text: 'merhaba' })
        const storage = await callPluginTool(extension.id, 'storage', {})
        const blocked = await callPluginTool(extension.id, 'blocked_require', {})
        const denied = await callPluginTool(extension.id, 'denied_fetch', {})
        lines.push(
          `plugin_state=${status.state} tools=${status.toolCount} error=${status.error ?? 'none'}`
        )
        lines.push(
          `plugin_agent_tools=${agentTools.length} names=${agentTools.map((tool) => tool.name).join(',')}`
        )
        lines.push(`plugin_echo_ok=${echo.ok} content=${JSON.stringify(echo.content)}`)
        lines.push(`plugin_storage_ok=${storage.ok} content=${JSON.stringify(storage.content)}`)
        lines.push(`plugin_require_blocked=${blocked.content.startsWith('blocked:')}`)
        lines.push(`plugin_network_denied=${denied.content.startsWith('denied:')}`)
        await unloadPlugin(extension.id)
        await removeExtension(extension.id)
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
        lines.push('plugin_cleaned=1')
      }

      if (process.env['EVREN_SELFTEST_MULTIVERSE'] === '1') {
        const controller = new AbortController()
        const events: ChatEvent[] = []
        const members = ['gemma-4-31b', 'mimo-v2.6-pro', 'qwen3.8-flash-next']

        await runMultiverse({
          requestId: 'selftest-mv',
          baseUrl: settings.baseUrl,
          apiKey: key,
          payload: {
            model: 'deepseek-v4.1-flash',
            messages: [{ role: 'user', content: 'Tek cümleyle yapay zeka nedir?' }],
            max_tokens: 512,
            thinking: false,
            multiverse: { enabled: true, members }
          },
          controller,
          send: (event) => events.push(event)
        })

        const memberResults = events.filter(
          (event): event is Extract<ChatEvent, { type: 'multiverse-member' }> =>
            event.type === 'multiverse-member'
        )
        const synthesis = events.filter(
          (event): event is Extract<ChatEvent, { type: 'multiverse-synthesis' }> =>
            event.type === 'multiverse-synthesis'
        )
        const done = events.find(
          (event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done'
        )
        const mvError = events.find(
          (event): event is Extract<ChatEvent, { type: 'error' }> => event.type === 'error'
        )
        const content = events
          .filter(
            (event): event is Extract<ChatEvent, { type: 'content' }> =>
              event.type === 'content'
          )
          .map((event) => event.text)
          .join('')

        lines.push(
          `mv_members=${members.length} results=${memberResults.length} ok=${memberResults.filter((event) => event.result.ok).length}`
        )
        lines.push(
          `mv_synthesis=${synthesis.length} done=${done?.finishReason ?? 'none'} error=${mvError?.error ?? 'none'}`
        )
        lines.push(
          `mv_content_len=${content.length} sample=${JSON.stringify(content.slice(0, 140))}`
        )
      }

      if (process.env['EVREN_SELFTEST_COMMANDS'] === '1') {
        const commands = await listCommands()
        lines.push(
          `commands=${commands.length} names=${commands
            .map((command) => `${command.source}:${command.name}`)
            .join(',')}`
        )
      }

      if (process.env['EVREN_SELFTEST_MEMORY'] === '1') {
        const commands = await listCommands()
        lines.push(
          `commands=${commands.length} names=${commands.map((command) => command.name).join(',')}`
        )

        const entry = await addMemory({
          type: 'user',
          text: 'Kod yazarken TypeScript kullanmayı tercih eder.',
          tags: ['test']
        })
        await setInstructions('Yanıtları kısa ve Türkçe ver.')
        const listed = await listMemories('TypeScript')
        const retrieved = await retrieveMemories(
          settings.baseUrl,
          key,
          'TypeScript tercihi nedir?',
          5,
          500
        )
        const memoryContext = await buildMemoryContext(settings.baseUrl, key, [
          { role: 'user', content: 'TypeScript kullanmalı mıyım?' }
        ])
        lines.push(
          `memory_listed=${listed.length} retrieved=${retrieved.some(
            (item) => item.id === entry.id
          )} context_len=${memoryContext?.length ?? 0}`
        )

        const learnSession = await createSession('deepseek-v4.1-flash')
        await appendMessage(learnSession.id, {
          id: crypto.randomUUID(),
          role: 'user',
          content:
            'Benim adım Kullanıcı. Kod yazarken TypeScript kullanmayı tercih ediyorum.',
          createdAt: Date.now()
        })
        await appendMessage(learnSession.id, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Anladım Kullanıcı, TypeScript tercihinizi not aldım.',
          createdAt: Date.now()
        })
        const learned = await learnFromSession(learnSession.id, settings.baseUrl, key)
        const afterLearn = await listMemories()
        const testMemories = afterLearn.filter(
          (item) => item.sourceSessionId === learnSession.id || item.id === entry.id
        )
        lines.push(
          `memory_learn_added=${learned.added} skipped=${learned.skipped ?? 'none'} test_entries=${testMemories.length}`
        )
        for (const item of testMemories) await deleteMemory(item.id)
        await deleteSession(learnSession.id)

        const originalSettings = await getSettings()
        const originalCompaction = originalSettings.compaction
        await updateSettings({
          compaction: {
            ...(originalCompaction ?? {}),
            auto: true,
            thresholdPercent: 80,
            keepTokens: 1000,
            bufferPercent: 10
          }
        })

        const compactionSession = await createSession('deepseek-v4.1-flash')
        for (let index = 0; index < 6; index += 1) {
          await appendMessage(compactionSession.id, {
            id: crypto.randomUUID(),
            role: 'user',
            content: `Soru ${index}: ${'Bu bir test mesajıdır. '.repeat(20)}`,
            createdAt: Date.now()
          })
          await appendMessage(compactionSession.id, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Cevap ${index}: ${'Bu da test cevabıdır. '.repeat(20)}`,
            createdAt: Date.now()
          })
        }

        const compacted = await compactSession(compactionSession.id, settings.baseUrl, key)
        lines.push(
          `compaction=${compacted.compacted} reason=${compacted.reason ?? 'none'} summary_len=${
            compacted.summary?.length ?? 0
          } count=${compacted.summaryMessageCount ?? 0} removed=${compacted.removedTokens ?? 0}`
        )
        await deleteSession(compactionSession.id)
        await updateSettings({ compaction: originalCompaction })
      }
    } catch (error) {
      lines.push(`api_error=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  process.stdout.write(`[selftest]\n${lines.join('\n')}\n`)
  app.exit(0)
}
