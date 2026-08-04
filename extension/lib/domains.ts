import { getInstance } from './settings'
import { getFreshToken } from './auth'

/** A registered domain (one per page hostname). */
export interface DomainInfo {
  id: string
  host: string
  name?: string
}

/** The hostname for a URL — the domain key — lowercased. Mirrors the server's hostOf. */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname
    return h ? h.toLowerCase() : null
  } catch {
    return null
  }
}

function base(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, '')
}

// Short caches so per-navigation gating doesn't hammer the API. Cleared on toggle
// (in this context) and via the DOMAINS_REFRESH message (across contexts).
const TTL = 60_000
let listCache: { url: string; at: number; domains: DomainInfo[] } | undefined
let enabledCache: { key: string; at: number; ids: string[] } | undefined

/** The instance's registered domains (public). Cached. */
export async function listDomains(force = false): Promise<DomainInfo[]> {
  const { instanceUrl } = await getInstance()
  if (!instanceUrl) return []
  if (!force && listCache && listCache.url === instanceUrl && Date.now() - listCache.at < TTL) {
    return listCache.domains
  }
  try {
    const res = await fetch(`${base(instanceUrl)}/api/domains`)
    if (!res.ok) return []
    const domains = (await res.json()) as DomainInfo[]
    listCache = { url: instanceUrl, at: Date.now(), domains }
    return domains
  } catch {
    return []
  }
}

/** The signed-in user's enabled domain ids. Cached per (instance, token). */
export async function enabledDomainIds(force = false): Promise<string[]> {
  const { instanceUrl } = await getInstance()
  const token = await getFreshToken()
  if (!instanceUrl || !token) return []
  const key = `${instanceUrl}|${token}`
  if (!force && enabledCache && enabledCache.key === key && Date.now() - enabledCache.at < TTL) {
    return enabledCache.ids
  }
  try {
    const res = await fetch(`${base(instanceUrl)}/api/domains/enabled`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const ids = (await res.json()) as string[]
    enabledCache = { key, at: Date.now(), ids }
    return ids
  } catch {
    return []
  }
}

export async function enableDomain(id: string): Promise<void> {
  return toggle(id, 'PUT')
}

export async function disableDomain(id: string): Promise<void> {
  return toggle(id, 'DELETE')
}

// Throws on failure (with the reason) so the UI can surface it instead of silently no-op'ing.
async function toggle(id: string, method: 'PUT' | 'DELETE'): Promise<void> {
  const { instanceUrl } = await getInstance()
  if (!instanceUrl) throw new Error('No instance configured')
  const token = await getFreshToken()
  if (!token) throw new Error('Please sign in again')
  const res = await fetch(`${base(instanceUrl)}/api/domains/${encodeURIComponent(id)}/enabled`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(res.status === 401 ? 'Please sign in again' : `Request failed (HTTP ${res.status})`)
  }
  enabledCache = undefined // reflect the change on the next read
}

/** Drop the caches (after a toggle, or when told to refresh from another context). */
export function clearDomainCache(): void {
  listCache = undefined
  enabledCache = undefined
}
