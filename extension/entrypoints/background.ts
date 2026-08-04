import '../lib/polyfills'; // must run before the channel (rsocket) loads
import { browser } from 'wxt/browser';
import { CAPTURE_MESSAGE } from '../lib/screenshot';
import { ping, ask, train, getQuestion, getAnswer, getWalkthroughSteps, knowledgeEdit, knowledgeUpdate, trainStart, trainStep, trainStop, trainSave, trainResummarize, suggestTags } from '../lib/channel';
import { getAuth, getFreshToken, isTrainer } from '../lib/auth';
import { getInstance } from '../lib/settings';
import { getConfig } from '../lib/config';
import { listDomains, enabledDomainIds, clearDomainCache } from '../lib/domains';
import { TRAIN_SET, TRAIN_GET, TRAIN_CLEAR } from '../lib/trainSession';

export const PING_MESSAGE = 'helpdoit:ping';
export const ASK_MESSAGE = 'helpdoit:ask';
export const ASK_FILES_MESSAGE = 'helpdoit:ask-files';
export const CONFIG_MESSAGE = 'helpdoit:config';
export const TRAIN_MESSAGE = 'helpdoit:train';
export const QUESTION_MESSAGE = 'helpdoit:question';
export const ANSWER_MESSAGE = 'helpdoit:answer';
export const QUESTION_SHOT_MESSAGE = 'helpdoit:question-screenshot';
export const STEPS_MESSAGE = 'helpdoit:walkthrough-steps';
export const KNOWLEDGE_EDIT_MESSAGE = 'helpdoit:knowledge-edit';
export const KNOWLEDGE_UPDATE_MESSAGE = 'helpdoit:knowledge-update';
export const TAGS_MESSAGE = 'helpdoit:tags';
export const REC_START = 'helpdoit:rec-start';
export const REC_STEP = 'helpdoit:rec-step';
export const REC_STOP = 'helpdoit:rec-stop';
export const REC_SAVE = 'helpdoit:rec-save';
export const REC_RESUMMARIZE = 'helpdoit:rec-resummarize';
export const REC_STATUS = 'helpdoit:rec-status';
export const SHOULD_SHOW_MESSAGE = 'helpdoit:should-show';
export const DOMAINS_REFRESH_MESSAGE = 'helpdoit:domains-refresh';
export const DOMAIN_TRAIN_HERE_MESSAGE = 'helpdoit:domain-train-here';

/** Per-tab Train-mode flag lives in session storage, keyed by tab id. */
const trainKey = (tabId: number) => `helpdoit:trainTab:${tabId}`;

/** The single active recording session (one at a time), in local storage. */
const REC_KEY = 'helpdoit:recording';
interface RecSession {
  walkthroughId: string;
  tabId: number;
  captureScreens: boolean;
  stepCount: number;
  lastPath?: string; // last recorded navigation pathname (to dedupe query-only changes)
}
async function getRec(): Promise<RecSession | null> {
  const s = await browser.storage.local.get(REC_KEY);
  return (s[REC_KEY] as RecSession) ?? null;
}
async function setRec(session: RecSession | null): Promise<void> {
  if (session) await browser.storage.local.set({ [REC_KEY]: session });
  else await browser.storage.local.remove(REC_KEY);
}

/**
 * Edit-record: "record from a selected point" while editing an entry. Holds the full
 * editor state + an insertion index; captures NEW steps locally (not a server
 * walkthrough), surviving navigation. On stop they're spliced into the steps and
 * handed back to the editor via PENDING_EDIT. One active at a time.
 */
const EDITREC_KEY = 'helpdoit:editrec';
const PENDING_EDIT_KEY = 'helpdoit:pendingEdit';
export const EDITREC_ARM = 'helpdoit:editrec-arm';
export const EDITREC_BEGIN = 'helpdoit:editrec-begin';
export const EDITREC_STATUS = 'helpdoit:editrec-status';
export const EDITREC_STOP = 'helpdoit:editrec-stop';
export const PENDING_EDIT_GET = 'helpdoit:pending-edit-get';
export const PENDING_EDIT_SET = 'helpdoit:pending-edit-set';

interface EditRecSession {
  knowledgeEntryId: string;
  question: string;
  answer: string;
  tags: string[];
  steps: unknown[]; // full current step list
  insertIndex: number;
  tabId: number;
  recording: boolean; // false while playing the prefix, true while capturing
  newSteps: unknown[];
}
async function getEditRec(): Promise<EditRecSession | null> {
  const s = await browser.storage.local.get(EDITREC_KEY);
  return (s[EDITREC_KEY] as EditRecSession) ?? null;
}
async function setEditRec(session: EditRecSession | null): Promise<void> {
  if (session) await browser.storage.local.set({ [EDITREC_KEY]: session });
  else await browser.storage.local.remove(EDITREC_KEY);
}

/** Capture the visible tab and POST it to the API for a step (HTTP, not RSocket —
 *  screenshots are too large for an RSocket-over-WS frame). Fire-and-forget. */
async function uploadScreenshot(walkthroughId: string, stepIndex: number): Promise<void> {
  const { instanceUrl } = await getInstance();
  if (!instanceUrl) return;
  let dataUrl: string | undefined;
  try {
    dataUrl = await browser.tabs.captureVisibleTab({ format: 'jpeg', quality: 60 });
  } catch {
    return;
  }
  if (!dataUrl) return;
  const image = dataUrl.replace(/^data:[^,]+,/, '');
  const token = await getFreshToken();
  await fetch(`${instanceUrl.replace(/\/+$/, '')}/api/walkthroughs/${walkthroughId}/screenshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ stepIndex, image, contentType: 'image/jpeg' }),
  });
}

/** Reconstruct a Blob from a base64 payload (files arrive base64'd — can't clone File to the worker). */
function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

/** Ask with file attachments over HTTP (multipart) — RSocket frames are too small for files. */
async function askWithFiles(payload: {
  text: string;
  pageUrl?: string;
  pageContext?: string;
  files: { name: string; type: string; dataBase64: string }[];
}): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { instanceUrl } = await getInstance();
  if (!instanceUrl) return { ok: false, error: 'NOT_CONFIGURED' };
  const token = await getFreshToken();
  const fd = new FormData();
  fd.append('text', payload.text);
  if (payload.pageUrl) fd.append('pageUrl', payload.pageUrl);
  if (payload.pageContext) fd.append('pageContext', payload.pageContext);
  for (const f of payload.files) {
    fd.append('files', base64ToBlob(f.dataBase64, f.type), f.name);
  }
  try {
    const res = await fetch(`${instanceUrl.replace(/\/+$/, '')}/api/ask`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    });
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };
    return { ok: true, result: await res.json() };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

/** The pathname of a URL (ignoring query + hash), for navigation dedupe. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** A page change in the recording tab becomes a 'navigate' step — but only a real
 *  route change. Live-search pages bump the query string per keystroke; those are
 *  the same pathname and would spam navigate steps, so we ignore query/hash-only changes. */
function recordNavigation(details: { tabId: number; frameId: number; url: string }): void {
  if (details.frameId !== 0) return; // main frame only
  getRec().then((session) => {
    if (!session || session.tabId !== details.tabId) return;
    const path = pathOf(details.url);
    if (session.lastPath === path) return; // query/hash-only change → not a real navigation
    session.lastPath = path;
    trainStep({
      walkthroughId: session.walkthroughId,
      step: { type: 'navigate', url: details.url, at: new Date().toISOString() },
    })
      .then((res) => {
        session.stepCount = res?.stepCount ?? session.stepCount + 1;
        return setRec(session);
      })
      .catch(() => {});
  });
}

export default defineBackground(() => {
  // Forget a tab's Train flag when it closes; stop a recording if its tab closes.
  browser.tabs.onRemoved.addListener((tabId) => {
    browser.storage.session.remove(trainKey(tabId));
    getRec().then((session) => {
      if (session?.tabId === tabId) setRec(null);
    });
    getEditRec().then((er) => {
      if (er?.tabId === tabId) setEditRec(null);
    });
  });

  // Page changes in the recording tab → 'navigate' steps (full loads + SPA routes).
  browser.webNavigation.onCommitted.addListener(recordNavigation);
  browser.webNavigation.onHistoryStateUpdated.addListener(recordNavigation);

  browser.runtime.onMessage.addListener((message, sender) => {
    // Should the widget mount on this host? It renders only when the signed-in user
    // has enabled a registered domain matching this hostname — EXCEPT a trainer who
    // armed Train mode for this tab (the "Train new domain" escape hatch), so they can
    // author the first entry on an unregistered host.
    if (message?.type === SHOULD_SHOW_MESSAGE) {
      return (async () => {
        const { instanceUrl } = await getInstance();
        if (!instanceUrl) return { show: false };

        const tabId = sender?.tab?.id;
        if (tabId != null) {
          const s = await browser.storage.session.get(trainKey(tabId));
          if (s[trainKey(tabId)]) return { show: true }; // armed Train mode wins
        }

        const host = String(message.hostname ?? '').toLowerCase();
        const [domains, enabled] = await Promise.all([listDomains(), enabledDomainIds()]);
        const match = domains.find((d) => d.host.toLowerCase() === host);
        return { show: !!match && enabled.includes(match.id) };
      })();
    }

    // Another context (the popup) changed enablement — drop the cached gating data.
    if (message?.type === DOMAINS_REFRESH_MESSAGE) {
      clearDomainCache();
      return Promise.resolve({ ok: true });
    }

    // Trainer "Train new domain": arm Train mode for the active tab and reload it so
    // the content script mounts the widget in a fresh authoring session.
    if (message?.type === DOMAIN_TRAIN_HERE_MESSAGE) {
      return (async () => {
        const auth = await getAuth();
        if (!isTrainer(auth)) return { ok: false, error: 'NOT_TRAINER' };
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id == null) return { ok: false, error: 'NO_TAB' };
        await browser.storage.session.set({ [trainKey(tab.id)]: { fresh: true } });
        await browser.tabs.reload(tab.id);
        return { ok: true };
      })();
    }

    // Screenshot capture (content scripts can't call tabs.captureVisibleTab).
    if (message?.type === CAPTURE_MESSAGE) {
      return browser.tabs
        .captureVisibleTab({ format: 'jpeg', quality: 70 })
        .then((dataUrl) => ({ ok: true, dataUrl }))
        .catch((error) => ({ ok: false, error: String(error) }));
    }

    // RSocket ping → pong over the channel to the API (connectivity check).
    if (message?.type === PING_MESSAGE) {
      return ping(message.payload)
        .then((pong) => ({ ok: true, pong }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // RSocket ask → the retrieve/answer-or-queue flow. Stamp the asker from the
    // signed-in profile (name, falling back to email) so it's attributed in the
    // admin queue. (Client-asserted for now; superseded once the channel carries
    // the JWT and the server derives the principal — see thread #4.)
    if (message?.type === ASK_MESSAGE) {
      return (async () => {
        const auth = await getAuth();
        const askedBy = auth?.name ?? auth?.email ?? null;
        return ask({ ...message.payload, askedBy })
          .then((result) => ({ ok: true, result }))
          .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      })();
    }

    // RSocket train → record a knowledge entry. Trainer/admin only; we re-check
    // the role here (defense-in-depth) on top of the UI gate.
    if (message?.type === TRAIN_MESSAGE) {
      return (async () => {
        const auth = await getAuth();
        if (!isTrainer(auth)) return { ok: false, error: 'NOT_TRAINER' };
        const authoredBy = auth?.name ?? auth?.email ?? null;
        return train({ ...message.payload, authoredBy })
          .then((result) => ({ ok: true, result }))
          .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      })();
    }

    // Ask with attachments → HTTP multipart (files can't ride the RSocket channel).
    if (message?.type === ASK_FILES_MESSAGE) {
      return askWithFiles(message.payload);
    }

    // Surface instance config the widget needs (e.g. whether attachments are allowed).
    if (message?.type === CONFIG_MESSAGE) {
      return getConfig()
        .then((config) => ({ ok: true, attachmentsEnabled: config?.attachmentsEnabled !== false }))
        .catch(() => ({ ok: true, attachmentsEnabled: false }));
    }

    // Store the page snapshot on a (queued) question — context for the trainer/AI.
    if (message?.type === QUESTION_SHOT_MESSAGE) {
      return (async () => {
        const { instanceUrl } = await getInstance();
        const qid = message.payload?.questionId;
        const dataUrl: string | undefined = message.payload?.image;
        if (!instanceUrl || !qid || !dataUrl) return { ok: false };
        const token = await getFreshToken();
        const image = dataUrl.replace(/^data:[^,]+,/, '');
        try {
          await fetch(`${instanceUrl.replace(/\/+$/, '')}/api/questions/${qid}/screenshot`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ image, contentType: 'image/jpeg' }),
          });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      })();
    }

    // Fetch a knowledge entry's full answer (user clicked a suggested option).
    if (message?.type === ANSWER_MESSAGE) {
      return getAnswer(message.payload?.knowledgeEntryId)
        .then((answer) => ({ ok: true, answer }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // Fetch a walkthrough's steps for playback ("Show me").
    if (message?.type === STEPS_MESSAGE) {
      return getWalkthroughSteps(message.payload?.knowledgeEntryId)
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // Load an existing knowledge entry for editing (the Edit/Retrain flow).
    if (message?.type === KNOWLEDGE_EDIT_MESSAGE) {
      return knowledgeEdit(message.payload?.knowledgeEntryId)
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // Save edits to an existing entry (trainer/admin only).
    if (message?.type === KNOWLEDGE_UPDATE_MESSAGE) {
      return (async () => {
        const auth = await getAuth();
        if (!isTrainer(auth)) return { ok: false, error: 'NOT_TRAINER' };
        try {
          const result = await knowledgeUpdate(message.payload);
          return { ok: true, result };
        } catch (error) {
          return { ok: false, error: String((error as Error)?.message ?? error) };
        }
      })();
    }

    // Look up a question by id (deep-link prefill).
    if (message?.type === QUESTION_MESSAGE) {
      return getQuestion(message.payload?.id)
        .then((question) => ({ ok: true, question }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // Tag type-ahead suggestions.
    if (message?.type === TAGS_MESSAGE) {
      return suggestTags(message.payload?.query ?? '')
        .then((tags) => ({ ok: true, tags }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // Recording: start a walkthrough for this tab (trainer/admin only).
    if (message?.type === REC_START) {
      return (async () => {
        const tabId = sender.tab?.id;
        if (tabId == null) return { ok: false, error: 'NO_TAB' };
        const auth = await getAuth();
        if (!isTrainer(auth)) return { ok: false, error: 'NOT_TRAINER' };
        const captureScreens = !!message.payload?.captureScreens;
        try {
          const res = await trainStart({
            questionId: message.payload?.questionId,
            captureScreens,
            createdBy: auth?.name ?? auth?.email ?? null,
          });
          await setRec({ walkthroughId: res.walkthroughId, tabId, captureScreens, stepCount: 0 });
          return { ok: true, walkthroughId: res.walkthroughId };
        } catch (error) {
          return { ok: false, error: String((error as Error)?.message ?? error) };
        }
      })();
    }

    // Recording: append a step (small, over RSocket); screenshot uploads over HTTP.
    if (message?.type === REC_STEP) {
      return (async () => {
        // Edit-record capture: if a "record from here" session is mid-capture, the
        // step is collected locally (spliced into the editor on stop) — not a server walkthrough.
        const er = await getEditRec();
        if (er?.recording) {
          er.newSteps.push(message.payload?.step);
          await setEditRec(er);
          return { ok: true, stepCount: er.newSteps.length };
        }
        const session = await getRec();
        if (!session) return { ok: false, error: 'NOT_RECORDING' };
        try {
          const res = await trainStep({
            walkthroughId: session.walkthroughId,
            step: message.payload?.step,
          });
          session.stepCount = res?.stepCount ?? session.stepCount + 1;
          await setRec(session);
          if (session.captureScreens && message.payload?.needScreenshot) {
            // index = count - 1; fire-and-forget so the click stays responsive.
            uploadScreenshot(session.walkthroughId, session.stepCount - 1).catch(() => {});
          }
          return { ok: true, stepCount: session.stepCount };
        } catch (error) {
          return { ok: false, error: String((error as Error)?.message ?? error) };
        }
      })();
    }

    // Recording: Stop → summarize into a review draft (answer + captioned steps).
    // Authoring happens later on Save. We clear the local recording session here.
    if (message?.type === REC_STOP) {
      return (async () => {
        const session = await getRec();
        if (!session) return { ok: true, stepCount: 0 };
        const walkthroughId = session.walkthroughId;
        let result: { status?: string; answer?: string; steps?: string; stepCount?: number } = {};
        try {
          result = await trainStop({ walkthroughId, question: message.payload?.question });
        } catch {
          /* still clear locally */
        }
        await setRec(null);
        return {
          ok: true,
          walkthroughId,
          stepCount: result?.stepCount ?? session.stepCount,
          answer: result?.answer,
          steps: result?.steps,
        };
      })();
    }

    // Review editor: regenerate the answer from the trainer's edited step captions.
    if (message?.type === REC_RESUMMARIZE) {
      return trainResummarize(message.payload)
        .then((result) => ({ ok: true, answer: result?.answer }))
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    }

    // Recording: Save the reviewed draft as knowledge.
    if (message?.type === REC_SAVE) {
      return (async () => {
        const auth = await getAuth();
        if (!isTrainer(auth)) return { ok: false, error: 'NOT_TRAINER' };
        try {
          const result = await trainSave(message.payload);
          return { ok: true, result };
        } catch (error) {
          return { ok: false, error: String((error as Error)?.message ?? error) };
        }
      })();
    }

    // Recording: status (so a fresh content script / widget can resume the UI).
    if (message?.type === REC_STATUS) {
      return getRec().then((session) => ({
        ok: true,
        recording: !!session && session.tabId === sender.tab?.id,
        walkthroughId: session?.walkthroughId,
        captureScreens: session?.captureScreens ?? false,
        stepCount: session?.stepCount ?? 0,
      }));
    }

    // Edit-record: arm a "record from here" session (before playing the prefix).
    if (message?.type === EDITREC_ARM) {
      const tabId = sender.tab?.id;
      if (tabId == null) return Promise.resolve({ ok: false });
      const p = message.payload ?? {};
      return setEditRec({
        knowledgeEntryId: p.knowledgeEntryId,
        question: p.question ?? '',
        answer: p.answer ?? '',
        tags: p.tags ?? [],
        steps: p.steps ?? [],
        insertIndex: p.insertIndex ?? (p.steps?.length ?? 0),
        tabId,
        recording: false,
        newSteps: [],
      }).then(() => ({ ok: true }));
    }
    // Edit-record: begin capturing (after the prefix played and the user clicked Record).
    if (message?.type === EDITREC_BEGIN) {
      return getEditRec().then((er) => {
        if (!er) return { ok: false };
        er.recording = true;
        return setEditRec(er).then(() => ({ ok: true }));
      });
    }
    // Edit-record: status (so a reloaded page can resume capturing + restore the UI).
    if (message?.type === EDITREC_STATUS) {
      return getEditRec().then((er) => ({
        ok: true,
        active: !!er && er.tabId === sender.tab?.id,
        recording: !!er?.recording,
        count: er?.newSteps.length ?? 0,
      }));
    }
    // Edit-record: stop → splice captured steps into the editor's list at the insertion
    // point, hand back via PENDING_EDIT, and clear the session.
    if (message?.type === EDITREC_STOP) {
      return (async () => {
        const er = await getEditRec();
        await setEditRec(null);
        if (!er) return { ok: true, merged: false };
        const steps = Array.isArray(er.steps) ? [...er.steps] : [];
        const at = Math.max(0, Math.min(er.insertIndex, steps.length));
        steps.splice(at, 0, ...er.newSteps);
        await browser.storage.local.set({
          [PENDING_EDIT_KEY]: {
            knowledgeEntryId: er.knowledgeEntryId,
            question: er.question,
            answer: er.answer,
            tags: er.tags,
            steps,
          },
        });
        return { ok: true, merged: true, added: er.newSteps.length };
      })();
    }
    // Stash the in-progress edit before a Preview, so the editor restores after it.
    if (message?.type === PENDING_EDIT_SET) {
      return browser.storage.local
        .set({ [PENDING_EDIT_KEY]: message.payload ?? {} })
        .then(() => ({ ok: true }));
    }
    // Consume the pending edit-resume payload (one-shot) after an edit-record stop.
    if (message?.type === PENDING_EDIT_GET) {
      return (async () => {
        const s = await browser.storage.local.get(PENDING_EDIT_KEY);
        const pending = s[PENDING_EDIT_KEY] ?? null;
        if (pending) await browser.storage.local.remove(PENDING_EDIT_KEY);
        return { ok: true, pending };
      })();
    }

    // Per-tab Train-mode flag (set by a deep-link, read on load, cleared on exit).
    // Keyed by the sender's tab id so each tab is independent.
    if (message?.type === TRAIN_SET) {
      const tabId = sender.tab?.id;
      if (tabId == null) return Promise.resolve({ ok: false });
      return browser.storage.session
        .set({ [trainKey(tabId)]: message.payload ?? {} })
        .then(() => ({ ok: true }));
    }
    if (message?.type === TRAIN_GET) {
      const tabId = sender.tab?.id;
      if (tabId == null) return Promise.resolve({ signal: null });
      return browser.storage.session
        .get(trainKey(tabId))
        .then((s) => ({ signal: s[trainKey(tabId)] ?? null }));
    }
    if (message?.type === TRAIN_CLEAR) {
      const tabId = sender.tab?.id;
      if (tabId == null) return Promise.resolve({ ok: true });
      return browser.storage.session.remove(trainKey(tabId)).then(() => ({ ok: true }));
    }

    return undefined; // let other listeners handle anything else
  });

  console.log('[helpdo.it] background ready', { id: browser.runtime.id });
});
