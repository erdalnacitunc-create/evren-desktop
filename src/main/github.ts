import type {
  GithubAccount,
  GithubDeviceCode,
  GithubDevicePoll,
  GithubRepo,
  GithubUser
} from '../shared/types'
import { clearGithubToken, loadGithubToken, saveGithubToken } from './credentials'

const API = 'https://api.github.com'
const USER_AGENT = 'EVREN-Desktop'

interface UserResponse {
  login?: string
  name?: string | null
  avatar_url?: string
  html_url?: string
  public_repos?: number
  total_private_repos?: number
  message?: string
}

interface RepoResponse {
  id?: number
  full_name?: string
  private?: boolean
  html_url?: string
  description?: string | null
  default_branch?: string
  updated_at?: string
  message?: string
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  }
}

async function fetchUser(token: string): Promise<{ user: GithubUser; scopes: string[] }> {
  const response = await fetch(`${API}/user`, { headers: headers(token) })
  const json = (await response.json().catch(() => ({}))) as UserResponse
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'GitHub token geçersiz veya süresi dolmuş.'
        : json.message || `GitHub API hatası: HTTP ${response.status}`
    )
  }
  if (!json.login) throw new Error('GitHub kullanıcı bilgisi alınamadı.')
  const scopes = (response.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
  return {
    user: {
      login: json.login,
      name: json.name ?? null,
      avatarUrl: json.avatar_url ?? '',
      htmlUrl: json.html_url ?? `https://github.com/${json.login}`,
      publicRepos: json.public_repos ?? 0,
      totalPrivateRepos: json.total_private_repos ?? 0
    },
    scopes
  }
}

export async function getGithubAccount(): Promise<GithubAccount> {
  const token = await loadGithubToken()
  if (!token) return { connected: false }
  try {
    const { user, scopes } = await fetchUser(token)
    return { connected: true, user, scopes }
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function connectGithubAccount(rawToken: string): Promise<GithubAccount> {
  const token = String(rawToken ?? '').trim()
  if (!token) throw new Error('GitHub token boş olamaz.')
  const { user, scopes } = await fetchUser(token)
  await saveGithubToken(token)
  return { connected: true, user, scopes }
}

export async function disconnectGithubAccount(): Promise<void> {
  await clearGithubToken()
}

export async function listGithubRepos(): Promise<GithubRepo[]> {
  const token = await loadGithubToken()
  if (!token) throw new Error('GitHub hesabı bağlı değil.')
  const response = await fetch(
    `${API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: headers(token) }
  )
  const json = (await response.json().catch(() => [])) as RepoResponse[] | RepoResponse
  if (!response.ok) {
    const message = Array.isArray(json) ? '' : json.message
    throw new Error(message || `GitHub repo listesi alınamadı: HTTP ${response.status}`)
  }
  if (!Array.isArray(json)) return []
  return json
    .filter((repo) => typeof repo.full_name === 'string')
    .map((repo) => ({
      id: repo.id ?? 0,
      fullName: repo.full_name ?? '',
      private: repo.private === true,
      htmlUrl: repo.html_url ?? '',
      description: repo.description ?? null,
      defaultBranch: repo.default_branch ?? 'main',
      updatedAt: repo.updated_at ?? ''
    }))
}

/* ---------------- GitHub OAuth Device Flow ---------------- */

interface DeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

interface DeviceTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
  interval?: number
}

const DEVICE_SCOPE = 'read:user repo read:org workflow'

function deviceHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT
  }
}

export async function startGithubDeviceFlow(clientId: string): Promise<GithubDeviceCode> {
  const id = String(clientId ?? '').trim()
  if (!id) throw new Error('GitHub OAuth App Client ID gerekli.')
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: deviceHeaders(),
    body: new URLSearchParams({ client_id: id, scope: DEVICE_SCOPE }).toString()
  })
  const json = (await response.json().catch(() => ({}))) as DeviceCodeResponse
  if (!response.ok || json.error) {
    const detail = json.error_description || json.error || ''
    if (
      response.status === 404 ||
      json.error === 'invalid_client' ||
      /not found/i.test(detail)
    ) {
      throw new Error(
        'GitHub Client ID geçersiz veya OAuth App’te Device Flow etkin değil.'
      )
    }
    throw new Error(detail || `GitHub cihaz kodu alınamadı: HTTP ${response.status}`)
  }
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error('GitHub cihaz kodu yanıtı eksik.')
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresIn: json.expires_in ?? 900,
    interval: json.interval ?? 5
  }
}

export async function pollGithubDeviceFlow(
  clientId: string,
  deviceCode: string
): Promise<GithubDevicePoll> {
  const id = String(clientId ?? '').trim()
  if (!id || !deviceCode) return { status: 'error', error: 'Eksik cihaz akışı bilgisi.' }
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: deviceHeaders(),
    body: new URLSearchParams({
      client_id: id,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }).toString()
  })
  const json = (await response.json().catch(() => ({}))) as DeviceTokenResponse
  if (json.access_token) {
    const token = json.access_token.trim()
    const { user, scopes } = await fetchUser(token)
    await saveGithubToken(token)
    return { status: 'success', account: { connected: true, user, scopes } }
  }
  if (json.error === 'authorization_pending') {
    return { status: 'pending' }
  }
  if (json.error === 'slow_down') {
    return { status: 'slow_down', interval: json.interval ?? 5 }
  }
  if (json.error === 'expired_token') {
    return { status: 'error', error: 'Cihaz kodu süresi doldu. Yeni kod oluşturun.' }
  }
  if (json.error === 'access_denied') {
    return { status: 'error', error: 'GitHub erişimi reddedildi.' }
  }
  if (json.error === 'incorrect_client_credentials') {
    return { status: 'error', error: 'GitHub Client ID geçersiz.' }
  }
  return {
    status: 'error',
    error: json.error_description || json.error || `GitHub token alınamadı: HTTP ${response.status}`
  }
}
