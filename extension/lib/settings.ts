import { browser } from 'wxt/browser'

/**
 * The only user/admin-facing setting: the helpdo.it instance URL. Everything
 * else (RSocket endpoint, sign-in providers, enabled sites) is fetched from
 * that instance's discovery doc — see lib/config.ts.
 */
export interface InstanceSetting {
  instanceUrl: string
  /** True when the value came from enterprise managed config (read-only). */
  managed: boolean
}

const KEY = 'helpdoit:settings'

/** Enterprise-pushed instance URL via chrome.storage.managed (wins, locked). */
async function getManagedInstanceUrl(): Promise<string | null> {
  try {
    const managed = await browser.storage.managed.get('instanceUrl')
    const value = (managed?.instanceUrl as string | undefined)?.trim()
    return value ? value : null
  } catch {
    return null // no managed storage / not configured
  }
}

export async function getInstance(): Promise<InstanceSetting> {
  const managed = await getManagedInstanceUrl()
  if (managed) return { instanceUrl: managed, managed: true }
  const stored = await browser.storage.local.get(KEY)
  const local = (stored[KEY] as { instanceUrl?: string } | undefined) ?? {}
  return { instanceUrl: (local.instanceUrl ?? '').trim(), managed: false }
}

export async function saveInstanceUrl(instanceUrl: string): Promise<void> {
  await browser.storage.local.set({ [KEY]: { instanceUrl: instanceUrl.trim() } })
}

/** Debug logging toggle (off by default) — gates the verbose [helpdoit] console logs. */
const DEBUG_KEY = 'helpdoit:debug'

export async function getDebug(): Promise<boolean> {
  try {
    const s = await browser.storage.local.get(DEBUG_KEY)
    return !!s[DEBUG_KEY]
  } catch {
    return false
  }
}

export async function setDebug(on: boolean): Promise<void> {
  await browser.storage.local.set({ [DEBUG_KEY]: on })
}
