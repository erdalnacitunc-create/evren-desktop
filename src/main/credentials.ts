import { app, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'

let cached: string | null = null
let cachedSource: 'stored' | 'env' | null = null

function keyFile(): string {
  return join(app.getPath('userData'), 'credentials.bin')
}

/** Anahtarin son 4 hanesini gosteren guvenli ozet. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

export async function loadApiKey(): Promise<string | null> {
  if (cached) return cached

  // Gelistirme/test icin ortam degiskeni (oncelikli)
  const fromEnv = process.env['EVREN_API_KEY']?.trim()
  if (fromEnv) {
    cached = fromEnv
    cachedSource = 'env'
    return cached
  }

  if (!safeStorage.isEncryptionAvailable()) return null

  try {
    const encrypted = await fs.readFile(keyFile())
    const decrypted = safeStorage.decryptString(encrypted).trim()
    if (!decrypted) return null
    cached = decrypted
    cachedSource = 'stored'
    return cached
  } catch {
    return null
  }
}

export function apiKeySource(): 'stored' | 'env' | null {
  return cachedSource
}

export async function saveApiKey(raw: string): Promise<void> {
  const key = raw.trim()
  if (!key) throw new Error('API anahtarı boş olamaz.')

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Güvenli saklama (Windows DPAPI) kullanılamıyor. Anahtar diske yazılmadı.'
    )
  }

  const encrypted = safeStorage.encryptString(key)
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(keyFile(), encrypted, { mode: 0o600 })
  cached = key
  cachedSource = 'stored'
}

export async function clearApiKey(): Promise<void> {
  cached = null
  cachedSource = null
  try {
    await fs.unlink(keyFile())
  } catch {
    // dosya yoksa sorun degil
  }
}

/* ---------------- GitHub token ---------------- */

let cachedGithubToken: string | null = null

function githubTokenFile(): string {
  return join(app.getPath('userData'), 'github-token.bin')
}

export async function loadGithubToken(): Promise<string | null> {
  if (cachedGithubToken) return cachedGithubToken
  const fromEnv = process.env['EVREN_GITHUB_TOKEN']?.trim()
  if (fromEnv) {
    cachedGithubToken = fromEnv
    return cachedGithubToken
  }
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = await fs.readFile(githubTokenFile())
    const decrypted = safeStorage.decryptString(encrypted).trim()
    if (!decrypted) return null
    cachedGithubToken = decrypted
    return cachedGithubToken
  } catch {
    return null
  }
}

export async function saveGithubToken(raw: string): Promise<void> {
  const token = raw.trim()
  if (!token) throw new Error('GitHub token boş olamaz.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Güvenli saklama (Windows DPAPI) kullanılamıyor.')
  }
  const encrypted = safeStorage.encryptString(token)
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(githubTokenFile(), encrypted, { mode: 0o600 })
  cachedGithubToken = token
}

export async function clearGithubToken(): Promise<void> {
  cachedGithubToken = null
  try {
    await fs.unlink(githubTokenFile())
  } catch {
    // yut
  }
}

export function githubTokenHint(): string | null {
  if (!cachedGithubToken) return null
  const token = cachedGithubToken
  return token.length <= 8 ? '••••' : `${token.slice(0, 4)}…${token.slice(-4)}`
}

/* ---------------- Headless API token ---------------- */

let cachedHeadlessToken: string | null = null

function headlessTokenFile(): string {
  return join(app.getPath('userData'), 'headless-token.bin')
}

export async function loadHeadlessToken(): Promise<string | null> {
  if (cachedHeadlessToken) return cachedHeadlessToken
  const fromEnv = process.env['EVREN_HEADLESS_TOKEN']?.trim()
  if (fromEnv) {
    cachedHeadlessToken = fromEnv
    return cachedHeadlessToken
  }
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = await fs.readFile(headlessTokenFile())
    const decrypted = safeStorage.decryptString(encrypted).trim()
    if (!decrypted) return null
    cachedHeadlessToken = decrypted
    return cachedHeadlessToken
  } catch {
    return null
  }
}

export async function saveHeadlessToken(token: string): Promise<void> {
  const value = token.trim()
  if (!value) throw new Error('Headless token boş olamaz.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Güvenli saklama (Windows DPAPI) kullanılamıyor.')
  }
  const encrypted = safeStorage.encryptString(value)
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(headlessTokenFile(), encrypted, { mode: 0o600 })
  cachedHeadlessToken = value
}

export async function ensureHeadlessToken(): Promise<string> {
  const existing = await loadHeadlessToken()
  if (existing) return existing
  const token = randomBytes(32).toString('hex')
  await saveHeadlessToken(token)
  return token
}

export async function regenerateHeadlessToken(): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await saveHeadlessToken(token)
  return token
}

/* ---------------- GitHub App private key ---------------- */

let cachedGithubAppKey: string | null = null

function githubAppKeyFile(): string {
  return join(app.getPath('userData'), 'github-app-key.bin')
}

export async function loadGithubAppKey(): Promise<string | null> {
  if (cachedGithubAppKey) return cachedGithubAppKey
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = await fs.readFile(githubAppKeyFile())
    const decrypted = safeStorage.decryptString(encrypted).trim()
    if (!decrypted) return null
    cachedGithubAppKey = decrypted
    return cachedGithubAppKey
  } catch {
    return null
  }
}

export async function saveGithubAppKey(privateKey: string): Promise<void> {
  const key = privateKey.trim()
  if (!key.includes('PRIVATE KEY')) throw new Error('Geçersiz private key (PEM).')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Güvenli saklama (Windows DPAPI) kullanılamıyor.')
  }
  const encrypted = safeStorage.encryptString(key)
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(githubAppKeyFile(), encrypted, { mode: 0o600 })
  cachedGithubAppKey = key
}

export async function clearGithubAppKey(): Promise<void> {
  cachedGithubAppKey = null
  try {
    await fs.unlink(githubAppKeyFile())
  } catch {
    // yut
  }
}
