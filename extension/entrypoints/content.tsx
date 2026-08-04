import '../components/widget.css';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { HelpWidget } from '../components/HelpWidget';
import { getAuth, isTrainer } from '../lib/auth';
import { consumeTrainDeepLink, markTabTrain, getTabTrain } from '../lib/trainSession';
import { resumeIfRecording } from '../lib/recorder';
import { resumePlaybackIfActive, resumeEditRecordIfActive } from '../lib/playback';
import { initDebug } from '../lib/log';

/**
 * Injects the helpdo.it help widget — but only when an instance is configured
 * and this site is enabled by that instance's discovery config. The content
 * script registers on <all_urls>; the gate is decided in the background (which
 * owns the network), so changes apply on page reload, no rebuild.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    initDebug(); // wire up the gated [helpdoit] debug logging (off unless enabled in settings)

    // A helpdo.it deep link can arrive via a hash change WITHOUT a full navigation —
    // e.g. opening Edit on a second entry reuses this tab, changing only the hash. The
    // deep link is consumed on a fresh load only, so without this we'd keep showing the
    // first entry until a manual hard refresh. Reload to re-run init on the new target.
    // (consumeTrainDeepLink strips the marker on load, so this can't loop.)
    window.addEventListener('hashchange', () => {
      if (/[#&]helpdoit=/.test(location.hash)) location.reload();
    });

    const res = (await browser.runtime.sendMessage({
      type: 'helpdoit:should-show',
      hostname: location.hostname,
    })) as { show?: boolean } | undefined;
    if (!res?.show) {
      return; // not configured, or widget disabled on this site
    }

    // Train/Edit deep-link: "#helpdoit=<questionId>" (train from the queue) or
    // "#helpdoit=k:<knowledgeId>" (edit an existing entry). Puts this tab into Train
    // mode if the signed-in user is a trainer; the flag persists per-tab so it survives
    // reloads/redirects until they switch back to FAQ.
    const deepLink = consumeTrainDeepLink();
    if (deepLink) {
      const auth = await getAuth();
      if (isTrainer(auth)) await markTabTrain(deepLink);
    }

    const trainState = await getTabTrain();
    let initialTrain: { qid?: string; question?: string } | undefined;
    let initialEdit:
      | {
          knowledgeEntryId: string;
          question: string;
          answer: string;
          tags: string[];
          steps: Record<string, unknown>[];
          hasWalkthrough: boolean;
        }
      | undefined;

    // After a "record from here" stop, we reloaded with the merged steps pending —
    // reopen the editor with them (takes precedence over re-fetching the entry).
    try {
      const pendingRes = (await browser.runtime.sendMessage({ type: 'helpdoit:pending-edit-get' })) as
        | { ok: boolean; pending?: { knowledgeEntryId: string; question?: string; answer?: string; tags?: string[]; steps?: Record<string, unknown>[] } }
        | undefined;
      const p = pendingRes?.pending;
      if (p) {
        initialEdit = {
          knowledgeEntryId: p.knowledgeEntryId,
          question: p.question ?? '',
          answer: p.answer ?? '',
          tags: p.tags ?? [],
          steps: p.steps ?? [],
          hasWalkthrough: (p.steps?.length ?? 0) > 0,
        };
      }
    } catch {
      /* no pending edit */
    }

    if (!initialEdit && trainState?.knowledgeId) {
      // Editing an existing entry — load its answer/tags/steps.
      try {
        const r = (await browser.runtime.sendMessage({
          type: 'helpdoit:knowledge-edit',
          payload: { knowledgeEntryId: trainState.knowledgeId },
        })) as
          | { ok: boolean; result?: { question?: string; answer?: string; tags?: string[]; steps?: string; hasWalkthrough?: boolean } }
          | undefined;
        if (r?.ok && r.result) {
          let steps: Record<string, unknown>[] = [];
          try {
            steps = r.result.steps ? (JSON.parse(r.result.steps) as Record<string, unknown>[]) : [];
          } catch {
            steps = [];
          }
          initialEdit = {
            knowledgeEntryId: trainState.knowledgeId,
            question: r.result.question ?? '',
            answer: r.result.answer ?? '',
            tags: r.result.tags ?? [],
            steps,
            hasWalkthrough: !!r.result.hasWalkthrough,
          };
        }
      } catch {
        /* fall through — no edit payload */
      }
    } else if (trainState?.qid) {
      // Resolve the question text by id (never carried in the URL — looked up).
      let question = '';
      try {
        const r = (await browser.runtime.sendMessage({
          type: 'helpdoit:question',
          payload: { id: trainState.qid },
        })) as { ok: boolean; question?: { text?: string } } | undefined;
        question = r?.ok ? (r.question?.text ?? '') : '';
      } catch {
        /* leave blank — the trainer can type the question */
      }
      initialTrain = { qid: trainState.qid, question };
    } else if (trainState?.fresh) {
      // "Train new domain": a fresh authoring session (no queued question/entry).
      initialTrain = { question: '' };
    }

    // If this tab was mid-recording (reload/redirect), re-attach the click capture
    // and tell the widget to show the recording state.
    const initialRecording = await resumeIfRecording();

    // If a guided playback was mid-flight (a click navigated us here), resume it.
    resumePlaybackIfActive();
    // If a "record from here" capture was mid-flight, resume capturing + the control bar.
    resumeEditRecordIfActive();

    const ui = await createShadowRootUi(ctx, {
      name: 'helpdoit-widget',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(
          <HelpWidget
            initialTrain={initialTrain}
            initialEdit={initialEdit}
            initialRecording={initialRecording}
          />,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
