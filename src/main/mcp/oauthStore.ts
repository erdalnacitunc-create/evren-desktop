import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface OAuthTokens {
  access_token: string
  token_type?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  [key: string]: unknown
}

export interface OAuthState {
  tokens?: OAuthTokens
  clientInformation?: Record<string, unknown>
  codeVerifier?: string
  discovery?: Record<string, unknown>
}

const cache = new Map<string, OAuthState>()

function fileName(serverId: string): string {
  const safe = serverId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
  return join(app.getPath('userData'), 'mcp-oauth', `${safe}.bin`)
}

export async function loadOAuthState(serverId: string): Promise<OAuthState> {
  if (cache.has(serverId)) return cache.get(serverId) as OAuthState
  if (!safeStorage.isEncryptionAvailable()) return {}
  try {
    const encrypted = await fs.readFile(fileName(serverId))
    const json = safeStorage.decryptString(encrypted)
    const parsed = JSON.parse(json) as OAuthState
    cache.set(serverId, parsed)
    return parsed
  } catch {
    return {}
  }
}

export async function saveOAuthState(serverId: string, state: OAuthState): Promise<void> {
  cache.set(serverId, state)
  if (!safeStorage.isEncryptionAvailable()) return
  const target = fileName(serverId)
  await fs.mkdir(join(app.getPath('userData'), 'mcp-oauth'), { recursive: true })
  await fs.writeFile(target, safeStorage.encryptString(JSON.stringify(state)), { mode: 0o600 })
}

export async function clearOAuthState(serverId: string): Promise<void> {
  cache.delete(serverId)
  try {
    await fs.unlink(fileName(serverId))
  } catch {
    // dosya yok
  }
}
