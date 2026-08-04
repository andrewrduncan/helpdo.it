import { getInstance } from './settings'

/** The instance's discovery document (GET {instanceUrl}/api/config). */
export interface AppConfig {
  wsUrl: string
  authStartPath: string
  providers: { id: string; label: string }[]
  enabledSites: string[]
  /** Whether the instance allows users to attach files to questions (central toggle). */
  attachmentsEnabled?: boolean
}

let cache: { url: string; config: AppConfig } | undefined

function normalize(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Fetch the discovery doc from an explicit instance URL (used to validate on setup). */
export async function fetchConfig(instanceUrl: string): Promise<AppConfig | null> {
  try {
    const res = await fetch(`${normalize(instanceUrl)}/api/config`)
    if (!res.ok) return null
    return (await res.json()) as AppConfig
  } catch {
    return null
  }
}

/** Discovery doc for the configured instance (cached). Null if no instance set. */
export async function getConfig(): Promise<AppConfig | null> {
  const { instanceUrl } = await getInstance()
  if (!instanceUrl) return null
  if (cache && cache.url === instanceUrl) return cache.config
  const config = await fetchConfig(instanceUrl)
  if (config) cache = { url: instanceUrl, config }
  return config
}

export function clearConfigCache(): void {
  cache = undefined
}

/** Whether the widget should appear on a hostname (empty list = all sites). */
export function siteEnabled(enabledSites: string[], hostname: string): boolean {
  if (enabledSites.length === 0) return true
  return enabledSites.some((pattern) => matchHost(pattern, hostname))
}

function matchHost(pattern: string, hostname: string): boolean {
  const p = pattern.trim().toLowerCase()
  const h = hostname.toLowerCase()
  if (!p || p === '*') return true
  if (p.startsWith('*.')) {
    const base = p.slice(2)
    return h === base || h.endsWith('.' + base)
  }
  return h === p
}
