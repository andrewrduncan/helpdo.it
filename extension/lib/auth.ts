import { browser } from 'wxt/browser'
import { getInstance } from './settings'
import { getConfig } from './config'

/** The signed-in user's verified identity + app JWT (persisted). */
export interface AuthInfo {
  token: string
  email?: string
  name?: string
  picture?: string
  roles?: string[]
  /** The provider used to sign in — so we can silently refresh the token later. */
  provider?: string
}

const KEY = 'helpdoit:auth'

export async function getAuth(): Promise<AuthInfo | null> {
  const stored = await browser.storage.local.get(KEY)
  return (stored[KEY] as AuthInfo) ?? null
}

async function setAuth(info: AuthInfo | null): Promise<void> {
  if (info) await browser.storage.local.set({ [KEY]: info })
  else await browser.storage.local.remove(KEY)
}

function parseJwt(token: string): {
  email?: string
  name?: string
  picture?: string
  roles?: string[]
  exp?: number
} {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return {}
  }
}

/** True when the JWT is missing/expired (or within a 60s safety margin of expiring). */
function tokenExpired(token: string | undefined): boolean {
  if (!token) return true
  const exp = parseJwt(token).exp
  if (typeof exp !== 'number') return false // no exp (e.g. dev token) → treat as live
  return exp * 1000 - Date.now() < 60_000
}

/** True when the signed-in user can author knowledge (Train mode). */
export function isTrainer(auth: AuthInfo | null): boolean {
  const roles = auth?.roles ?? []
  return roles.includes('trainer') || roles.includes('admin')
}

/** Silent-first: try without UI (succeeds on SSO devices, e.g. Entra), else prompt. */
async function launch(url: string, allowInteractive: boolean): Promise<string> {
  try {
    const silent = await browser.identity.launchWebAuthFlow({ url, interactive: false })
    if (silent) return silent
  } catch {
    /* interaction required — fall through (only if allowed) */
  }
  if (!allowInteractive) throw new Error('Silent sign-in failed')
  const interactive = await browser.identity.launchWebAuthFlow({ url, interactive: true })
  if (!interactive) throw new Error('Sign-in was cancelled')
  return interactive
}

/**
 * Run the configured instance's server-side OIDC and persist the returned app JWT. The
 * API runs the provider redirect and hands the token back to this extension's
 * chromiumapp.org URL. {@code allowInteractive=false} is used for silent token refresh.
 */
async function runSignIn(providerId: string, allowInteractive: boolean): Promise<AuthInfo> {
  const { instanceUrl } = await getInstance()
  if (!instanceUrl) throw new Error('No instance configured')
  const config = await getConfig()
  const authStartPath = config?.authStartPath ?? '/oauth2/authorization'

  const redirectUri = browser.identity.getRedirectURL()
  const url =
    `${instanceUrl.replace(/\/+$/, '')}${authStartPath}/${providerId}` +
    `?client_redirect=${encodeURIComponent(redirectUri)}`

  const resultUrl = await launch(url, allowInteractive)
  const hash = new URL(resultUrl).hash.replace(/^#/, '')
  const token = new URLSearchParams(hash).get('token')
  if (!token) throw new Error('No token returned from sign-in')

  const claims = parseJwt(token)
  const info: AuthInfo = {
    token,
    email: claims.email,
    name: claims.name,
    picture: claims.picture || undefined,
    roles: claims.roles ?? [],
    provider: providerId,
  }
  await setAuth(info)
  return info
}

/** Interactive sign-in (the popup's Sign in button). */
export function signIn(providerId: string): Promise<AuthInfo> {
  return runSignIn(providerId, true)
}

/**
 * Silently refresh the app JWT by re-running OIDC without UI (works while the provider
 * session is still alive). Returns the new auth, or null if a silent refresh isn't
 * possible — the caller then falls back to asking the user to sign in.
 */
export async function refreshAuth(): Promise<AuthInfo | null> {
  const current = await getAuth()
  if (!current?.provider) return null
  try {
    return await runSignIn(current.provider, false)
  } catch {
    return null
  }
}

/**
 * A usable bearer token: the stored one if still valid, otherwise a silently-refreshed
 * one. Null when there's no session or a silent refresh failed (→ user must sign in).
 */
export async function getFreshToken(): Promise<string | null> {
  const auth = await getAuth()
  if (!auth?.token) return null
  if (!tokenExpired(auth.token)) return auth.token
  const refreshed = await refreshAuth()
  return refreshed?.token ?? null
}

export async function signOut(): Promise<void> {
  await setAuth(null)
}
