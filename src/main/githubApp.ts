import { createSign } from 'crypto'
import type {
  GithubAppInstallation,
  GithubAppStatus
} from '../shared/types'
import {
  clearGithubAppKey,
  loadGithubAppKey,
  saveGithubAppKey
} from './credentials'
import { getSettings, updateSettings } from './settings'

const API = 'https://api.github.com'
const USER_AGENT = 'EVREN-Desktop'

interface RawInstallation {
  id?: number
  account?: { login?: string; type?: string }
  repository_selection?: string
  html_url?: string
  app_slug?: string
}

interface TokenResponse {
  token?: string
  expires_at?: string
  message?: string
}

let cachedToken:
  | { token: string; expiresAt: number; installationId: number }
  | null = null

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })
  )
  const data = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  signer.end()
  const signature = signer.sign(privateKey)
  return `${data}.${base64url(signature)}`
}

async function appRequest<T>(
  appId: string,
  privateKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const jwt = appJwt(appId, privateKey)
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${jwt}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    },
    signal: AbortSignal.timeout(20_000)
  })
  const json = (await response.json().catch(() => ({}))) as T & {
    message?: string
  }
  if (!response.ok) {
    throw new Error(
      json.message || `GitHub App API hatası: HTTP ${response.status}`
    )
  }
  return json
}

function normalizeInstallation(item: RawInstallation): GithubAppInstallation | null {
  if (!item.id || !item.account?.login) return null
  return {
    id: item.id,
    accountLogin: item.account.login,
    accountType: item.account.type ?? 'User',
    repositorySelection: item.repository_selection ?? 'all',
    htmlUrl: item.html_url ?? '',
    appSlug: item.app_slug
  }
}

export async function listGithubAppInstallations(): Promise<GithubAppInstallation[]> {
  const settings = await getSettings()
  const appId = settings.githubApp?.appId
  const key = await loadGithubAppKey()
  if (!appId || !key) throw new Error('GitHub App ID ve private key gerekli.')
  const list = await appRequest<RawInstallation[]>(appId, key, '/app/installations')
  return (Array.isArray(list) ? list : [])
    .map(normalizeInstallation)
    .filter((item): item is GithubAppInstallation => item !== null)
}

async function mintInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number
): Promise<{ token: string; expiresAt: number }> {
  const response = await appRequest<TokenResponse>(
    appId,
    privateKey,
    `/app/installations/${installationId}/access_tokens`,
    { method: 'POST', body: '{}' }
  )
  if (!response.token) throw new Error('Installation token alınamadı.')
  const expiresAt = response.expires_at
    ? new Date(response.expires_at).getTime()
    : Date.now() + 55 * 60_000
  return { token: response.token, expiresAt }
}

export async function getGithubAppToken(): Promise<string | null> {
  const settings = await getSettings()
  const appId = settings.githubApp?.appId
  const installationId = settings.githubApp?.installationId
  if (!appId || !installationId) return null
  const key = await loadGithubAppKey()
  if (!key) return null
  if (
    cachedToken &&
    cachedToken.installationId === installationId &&
    cachedToken.expiresAt > Date.now() + 120_000
  ) {
    return cachedToken.token
  }
  try {
    const minted = await mintInstallationToken(appId, key, installationId)
    cachedToken = { ...minted, installationId }
    return minted.token
  } catch {
    cachedToken = null
    return null
  }
}

export async function githubAppStatus(): Promise<GithubAppStatus> {
  const settings = await getSettings()
  const config = settings.githubApp
  const key = await loadGithubAppKey()
  if (!config?.appId) return { configured: false }
  if (!key) {
    return {
      configured: false,
      appId: config.appId,
      error: 'Private key bulunamadı. Yeniden yükleyin.'
    }
  }
  return {
    configured: !!config.installationId,
    appId: config.appId,
    installationId: config.installationId,
    accountLogin: config.accountLogin,
    repositorySelection: config.repositorySelection,
    hasKey: true,
    tokenExpiresAt:
      cachedToken && cachedToken.installationId === config.installationId
        ? cachedToken.expiresAt
        : undefined
  }
}

export async function saveGithubAppCredentials(
  appIdRaw: string,
  privateKeyRaw: string
): Promise<GithubAppStatus> {
  const appId = String(appIdRaw ?? '').trim()
  const privateKey = String(privateKeyRaw ?? '').trim()
  if (!appId) throw new Error('GitHub App ID gerekli.')
  if (!/^\d+$/.test(appId)) throw new Error('GitHub App ID sayısal olmalı.')
  if (!privateKey.includes('PRIVATE KEY')) {
    throw new Error('Geçerli bir PEM private key yapıştırın.')
  }
  await saveGithubAppKey(privateKey)
  await updateSettings({
    githubApp: {
      appId,
      installationId: undefined,
      accountLogin: undefined,
      repositorySelection: undefined
    }
  })
  cachedToken = null
  return githubAppStatus()
}

export async function connectGithubAppInstallation(
  installationIdRaw: number
): Promise<GithubAppStatus> {
  const installationId = Math.round(Number(installationIdRaw))
  if (!Number.isFinite(installationId) || installationId <= 0) {
    throw new Error('Geçersiz installation ID.')
  }
  const installations = await listGithubAppInstallations()
  const installation = installations.find((item) => item.id === installationId)
  if (!installation) throw new Error('Kurulum bulunamadı.')
  const settings = await getSettings()
  const appId = settings.githubApp?.appId
  const key = await loadGithubAppKey()
  if (!appId || !key) throw new Error('GitHub App yapılandırması eksik.')

  const minted = await mintInstallationToken(appId, key, installationId)
  cachedToken = { ...minted, installationId }
  await updateSettings({
    githubApp: {
      appId,
      installationId,
      accountLogin: installation.accountLogin,
      repositorySelection: installation.repositorySelection
    }
  })
  return githubAppStatus()
}

export async function refreshGithubAppToken(): Promise<GithubAppStatus> {
  const settings = await getSettings()
  const appId = settings.githubApp?.appId
  const installationId = settings.githubApp?.installationId
  const key = await loadGithubAppKey()
  if (!appId || !installationId || !key) {
    throw new Error('GitHub App bağlantısı yapılandırılmamış.')
  }
  const minted = await mintInstallationToken(appId, key, installationId)
  cachedToken = { ...minted, installationId }
  return githubAppStatus()
}

export async function disconnectGithubApp(): Promise<GithubAppStatus> {
  cachedToken = null
  await clearGithubAppKey()
  await updateSettings({ githubApp: undefined })
  return { configured: false }
}
