import { browser } from 'wxt/browser';

/**
 * A Train deep-link payload. Either training a queued question (`qid`) or EDITING an
 * existing knowledge entry (`knowledgeId`, from a `#helpdoit=k:<id>` link).
 */
export interface TrainSignal {
  qid?: string;
  knowledgeId?: string;
  /** A fresh authoring session (e.g. "Train new domain") — no queued question or entry. */
  fresh?: boolean;
}

export const TRAIN_SET = 'helpdoit:train-set';
export const TRAIN_GET = 'helpdoit:train-get';
export const TRAIN_CLEAR = 'helpdoit:train-clear';

/**
 * Read a Train deep-link from the URL hash (#helpdoit=&lt;questionId&gt;), strip
 * our marker from the URL, and return the question id — or null if absent. Uses
 * the hash (not a query param) so it never reaches the host app's server and
 * survives its client-side routing/redirects. The question text is looked up by
 * id, never carried in the URL.
 */
export function consumeTrainDeepLink(): TrainSignal | null {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const value = params.get('helpdoit');
  if (!value) return null;

  // Remove our marker, preserve anything else the app kept in the hash.
  params.delete('helpdoit');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));

  // "k:<id>" → edit an existing knowledge entry; otherwise it's a queued question id.
  if (value.startsWith('k:')) {
    return { knowledgeId: value.slice(2) };
  }
  return { qid: value };
}

/** Persist Train mode for THIS tab (the background keys it by sender tab id). */
export async function markTabTrain(signal: TrainSignal): Promise<void> {
  await browser.runtime.sendMessage({ type: TRAIN_SET, payload: signal });
}

/** Read the current tab's persisted Train signal, if any. */
export async function getTabTrain(): Promise<TrainSignal | null> {
  const res = (await browser.runtime.sendMessage({ type: TRAIN_GET })) as
    | { signal?: TrainSignal | null }
    | undefined;
  return res?.signal ?? null;
}

/** Exit Train mode for this tab (so a later reload won't re-enter it). */
export async function clearTabTrain(): Promise<void> {
  await browser.runtime.sendMessage({ type: TRAIN_CLEAR });
}
