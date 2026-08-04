import { browser } from 'wxt/browser';

/** Message the background worker uses to capture the visible tab. */
export const CAPTURE_MESSAGE = 'helpdoit:capture';

interface CaptureResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

/**
 * Ask the background service worker to screenshot the visible tab. Content
 * scripts can't call tabs.captureVisibleTab themselves, so this round-trips
 * through the background. Returns a JPEG data URL, or undefined if capture
 * failed (e.g. on a restricted page like chrome://).
 */
export async function captureScreenshot(): Promise<string | undefined> {
  try {
    const res = (await browser.runtime.sendMessage({ type: CAPTURE_MESSAGE })) as
      | CaptureResult
      | undefined;
    return res?.ok ? res.dataUrl : undefined;
  } catch {
    return undefined;
  }
}
