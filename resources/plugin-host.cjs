// EVREN Desktop plugin host — izole utility process.
// Plugin kodu vm context'inde calisir; fs/net/electron dogrudan erisilemez.

const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const tools = new Map()
const pendingRpc = new Map()
let rpcCounter = 0
let disposed = false

function post(message) {
  try {
    process.parentPort.postMessage(message)
  } catch {
    // parent kapanmis olabilir
  }
}

function rpc(method, params) {
  const id = String(++rpcCounter)
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject })
    post({ type: 'rpc', id, method, params })
    setTimeout(() => {
      if (pendingRpc.has(id)) {
        pendingRpc.delete(id)
        reject(new Error(`RPC zaman aşımı: ${method}`))
      }
    }, 30000)
  })
}

function describeError(error) {
  return error && error.stack ? String(error.stack) : String(error)
}

function createApi() {
  const log = (...args) => {
    const message = args
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      .join(' ')
    post({ type: 'log', message: message.slice(0, 4000) })
  }

  return {
    registerTool(definition) {
      if (!definition || typeof definition.name !== 'string') {
        throw new Error('registerTool: name gerekli.')
      }
      if (typeof definition.execute !== 'function') {
        throw new Error('registerTool: execute fonksiyonu gerekli.')
      }
      tools.set(definition.name, definition)
    },
    log,
    fetch: (url, init) => rpc('fetch', { url: String(url), init: init ?? undefined }),
    storage: {
      get: (key) => rpc('storage.get', { key: String(key) }),
      set: (key, value) => rpc('storage.set', { key: String(key), value })
    }
  }
}

function safeRequire(name) {
  throw new Error(`Plugin require('${name}') izinli değil. Eklenti bağımsız olmalıdır.`)
}

async function loadPlugin(payload) {
  const directory = payload.pluginPath
  const entry = payload.entry || 'index.js'
  const file = path.join(directory, entry)

  const code = fs.readFileSync(file, 'utf8')
  const module = { exports: {} }

  const sandbox = {
    module,
    exports: module.exports,
    require: safeRequire,
    __dirname: directory,
    __filename: file,
    console: {
      log: (...args) => post({ type: 'log', message: args.map(String).join(' ') }),
      warn: (...args) => post({ type: 'log', message: args.map(String).join(' ') }),
      error: (...args) => post({ type: 'log', message: args.map(String).join(' ') })
    },
    fetch: (url, init) => rpc('fetch', { url: String(url), init: init ?? undefined }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder
  }

  const context = vm.createContext(sandbox)
  vm.runInContext(code, context, { filename: file, timeout: 10000 })

  const exported = module.exports
  let register = null
  if (typeof exported === 'function') register = exported
  else if (exported && typeof exported.register === 'function') register = exported.register
  else if (exported && exported.default && typeof exported.default.register === 'function') {
    register = exported.default.register
  }
  if (!register) {
    throw new Error('Eklenti register(api) fonksiyonu dışa aktarmalı.')
  }

  await register(createApi())
}

async function callTool(message) {
  const tool = tools.get(message.tool)
  if (!tool) {
    post({
      type: 'call-result',
      id: message.id,
      ok: false,
      content: `Araç bulunamadı: ${message.tool}`
    })
    return
  }

  try {
    const result = await tool.execute(message.args ?? {})
    const content =
      typeof result === 'string'
        ? result
        : result && typeof result === 'object' && typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result)
    post({ type: 'call-result', id: message.id, ok: true, content: String(content) })
  } catch (error) {
    post({
      type: 'call-result',
      id: message.id,
      ok: false,
      content: `Eklenti hatası: ${describeError(error)}`
    })
  }
}

process.parentPort.on('message', (event) => {
  const message = event.data
  if (!message || disposed) return

  if (message.type === 'init') {
    loadPlugin(message)
      .then(() => {
        post({
          type: 'ready',
          tools: [...tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
          }))
        })
      })
      .catch((error) => {
        post({ type: 'init-error', error: describeError(error) })
      })
    return
  }

  if (message.type === 'call') {
    void callTool(message)
    return
  }

  if (message.type === 'rpc-result') {
    const pending = pendingRpc.get(message.id)
    if (!pending) return
    pendingRpc.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error ?? 'RPC hatası'))
    return
  }

  if (message.type === 'dispose') {
    disposed = true
    process.exit(0)
  }
})

process.on('uncaughtException', (error) => {
  post({ type: 'host-error', error: describeError(error) })
})
process.on('unhandledRejection', (error) => {
  post({ type: 'host-error', error: describeError(error) })
})
