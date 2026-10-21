#!/usr/bin/env node
/**
 * EVREN Desktop ACP köprüsü.
 *
 * ACP istemcileri (Zed vb.) ajanı stdio ile başlatır. Electron GUI süreci
 * Windows'ta stdin'i güvenilir okumadığı için bu köprü:
 *   stdin/stdout  <->  TCP 127.0.0.1:<rastgele port>  <->  Electron --acp
 * şeklinde çalışır. Token handshake'i ile yalnızca bu köprü bağlanabilir.
 *
 * Kullanım:
 *   node acp/evren-acp-bridge.cjs
 *   EVREN_ACP_ELECTRON=/path/to/electron node acp/evren-acp-bridge.cjs
 */
const net = require('net')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function electronExecutable() {
  if (process.env.EVREN_ACP_ELECTRON) return process.env.EVREN_ACP_ELECTRON
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
          path.join(root, 'node_modules', 'electron', 'dist', 'Electron.exe')
        ]
      : [
          path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
          path.join(root, 'node_modules', 'electron', 'dist', 'Electron')
        ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function connectWithRetry(port, token) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const tryConnect = () => {
      attempts += 1
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.setEncoding('utf8')
      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ evren_acp_token: token })}\n`)
        resolve(socket)
      })
      socket.once('error', () => {
        socket.destroy()
        if (attempts >= 150) {
          reject(new Error('ACP sunucusuna bağlanılamadı.'))
          return
        }
        setTimeout(tryConnect, 100)
      })
    }
    tryConnect()
  })
}

async function main() {
  const executable = electronExecutable()
  if (!executable) {
    throw new Error(
      'Electron bulunamadı. EVREN_ACP_ELECTRON ortam değişkeniyle yolu belirtin.'
    )
  }

  const port = await freePort()
  const token = crypto.randomBytes(24).toString('hex')
  const child = spawn(executable, [root, '--acp'], {
    cwd: root,
    env: {
      ...process.env,
      EVREN_ACP: '1',
      EVREN_ACP_PORT: String(port),
      EVREN_ACP_TOKEN: token
    },
    stdio: ['ignore', 'ignore', 'inherit'],
    windowsHide: true
  })

  let exiting = false
  const shutdown = (code) => {
    if (exiting) return
    exiting = true
    try {
      child.kill()
    } catch {
      // yut
    }
    process.exit(code)
  }

  child.once('exit', (code) => {
    if (!exiting) {
      process.stderr.write(`[evren-acp] ajan kapandı (kod ${code ?? 0}).\n`)
      process.exit(code ?? 0)
    }
  })
  child.once('error', (error) => {
    process.stderr.write(`[evren-acp] ajan başlatılamadı: ${error.message}\n`)
    shutdown(1)
  })

  let socket
  try {
    socket = await connectWithRetry(port, token)
  } catch (error) {
    process.stderr.write(`[evren-acp] ${error.message}\n`)
    shutdown(1)
    return
  }

  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
  process.stdin.on('end', () => socket.end())
  socket.once('close', () => shutdown(0))
  socket.once('error', (error) => {
    process.stderr.write(`[evren-acp] bağlantı hatası: ${error.message}\n`)
    shutdown(1)
  })
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
}

main().catch((error) => {
  process.stderr.write(`[evren-acp] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
