import { browser } from 'wxt/browser';

/**
 * Debug logging, gated by a user setting (off by default). `dlog`/`dwarn` only emit
 * when "Debug logging" is enabled in the extension options; real errors (`derror`)
 * always log. Call {@link initDebug} once on script load to read the flag and keep
 * it in sync with the setting.
 */
export const DEBUG_KEY = 'helpdoit:debug';

let enabled = false;

export async function initDebug(): Promise<void> {
  try {
    const s = await browser.storage.local.get(DEBUG_KEY);
    enabled = !!s[DEBUG_KEY];
  } catch {
    /* no storage access — stay off */
  }
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[DEBUG_KEY]) enabled = !!changes[DEBUG_KEY].newValue;
    });
  } catch {
    /* ignore */
  }
}

export function dlog(...args: unknown[]): void {
  if (enabled) console.log('[helpdoit]', ...args);
}

export function dwarn(...args: unknown[]): void {
  if (enabled) console.warn('[helpdoit]', ...args);
}

export function derror(...args: unknown[]): void {
  console.error('[helpdoit]', ...args);
}
