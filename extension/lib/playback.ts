/**
 * Guided playback: replays a recorded walkthrough by animating a simulated cursor
 * to each step's element, showing the step's caption, and performing the click for
 * the user. The mirror image of the recorder.
 *
 * Steps identify elements by their resolution-independent locator (selector →
 * hierarchy → text) and a click point stored as a fraction (offset.rx/ry) of the
 * element's rect — re-resolved live so it lands correctly at any size. A click that
 * navigates destroys this JS context; progress lives in sessionStorage (survives
 * same-origin navigation) and the next page's content script resumes via
 * resumePlaybackIfActive().
 */

import { browser } from 'wxt/browser';
import { dlog, dwarn, derror } from './log';
import { attachCapture, detachCapture, setOnStep } from './recorder';
import { resolveTarget, actionable, type LocatorTarget } from './locate';

type StepTarget = LocatorTarget;
export interface PlayStep {
  type: 'click' | 'rightClick' | 'navigate' | 'input' | 'select' | 'toggle';
  url?: string;
  caption?: string;
  value?: string | boolean; // input text / select value / toggle state
  label?: string; // chosen option label (select)
  target?: StepTarget;
  // How playback handles the step: 'auto' performs it; 'input' pauses for the user to
  // type their own value; 'pick' highlights the choices and waits for the user to click one.
  mode?: 'auto' | 'input' | 'pick';
  prompt?: string; // user-facing instruction shown during an input/pick pause
}

interface PlayState {
  steps: PlayStep[];
  index: number;
  performed: number; // how many steps we actually clicked (to detect an unplayable recording)
  editRecord?: boolean; // this is the "play the prefix, then record from here" flow
  returnToEdit?: boolean; // a Preview from the editor — reload back into the editor when done
}

const KEY = 'helpdoit:playback';
const STEP_PAUSE = 950; // ms between steps so it's watchable
const MOVE_MS = 700; // cursor travel time
const RESOLVE_TRIES = 12; // ~2.4s of retries for an element to appear
const TYPING_IDLE_MS = 700; // quiet period after the last keystroke before we treat typing as "done"
const NEXT_POLL_MS = 300; // how often we re-check for the next step's target after typing settles
const NEXT_POLL_TRIES = 16; // ~4.8s window for server results to come back before we give up auto-advancing

let overlay: PlaybackOverlay | null = null;
let timer: number | undefined;
// After a satisfying pick, ignore further clicks until this time — so the trailing
// click of a double-click can't also satisfy the next step.
let suppressClicksUntil = 0;

function getState(): PlayState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayState) : null;
  } catch {
    return null;
  }
}
function setState(state: PlayState | null): void {
  try {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Begin playing a freshly-fetched walkthrough. */
export function startPlayback(steps: PlayStep[]): void {
  dlog('startPlayback', steps?.length ?? 0, 'steps', steps);
  if (!steps || steps.length === 0) return;
  setState({ steps, index: 0, performed: 0 });
  ensureOverlay();
  run();
}

/** Preview from the editor: play the in-progress steps, then reload back into the editor. */
export function startPreview(steps: PlayStep[]): void {
  if (!steps || steps.length === 0) return;
  setState({ steps, index: 0, performed: 0, returnToEdit: true });
  ensureOverlay();
  run();
}

/** The page a walkthrough was recorded on (its first step's URL) — where playback must start. */
export function playbackStartUrl(steps: PlayStep[]): string | undefined {
  return steps.find((s) => s.url)?.url;
}

/**
 * Can the walkthrough start on the CURRENT page? True when its first actionable step's
 * target resolves here — so a walkthrough whose entry control (e.g. a global search box)
 * exists on several pages plays in place instead of forcing a jump to the recorded page.
 */
export function canStartHere(steps: PlayStep[]): boolean {
  for (const s of steps) {
    if (s.type === 'navigate' || isJunkStep(s)) continue;
    return !!resolveTarget(s.target).best;
  }
  return false;
}

// --- Path templating: treat dynamic segments (ids) as wildcards so a walkthrough
// recorded on /order/<some-id> matches /order/<a-different-id> — we don't redirect
// the user to the specific order that happened to be recorded.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Does a path segment look like an id (UUID, number, long hex, or long mixed alnum)? */
function isDynamicSegment(seg: string): boolean {
  if (!seg) return false;
  if (UUID_RE.test(seg)) return true;
  if (/^\d+$/.test(seg)) return true; // pure numeric id
  if (/^[0-9a-f]{12,}$/i.test(seg)) return true; // long hex / hash
  if (seg.length >= 16 && /\d/.test(seg) && /^[a-z0-9._-]+$/i.test(seg)) return true; // long opaque id
  return false;
}

/** Collapse a path to its pattern: dynamic id segments → "*". */
export function pathTemplate(path: string): string {
  return path
    .split('/')
    .map((s) => (isDynamicSegment(s) ? '*' : s.toLowerCase()))
    .join('/')
    .replace(/\/$/, '');
}

/** Two paths share the same structure (same static segments; ids may differ). */
export function samePattern(a: string, b: string): boolean {
  return pathTemplate(a) === pathTemplate(b);
}

/** Does this path contain a dynamic (id) segment — i.e. it's parameterized? */
export function pathHasParams(path: string): boolean {
  return path.split('/').some(isDynamicSegment);
}

/**
 * Persist the playback as pending WITHOUT running it, for the case where we first
 * navigate to the start page — the next page load's resumePlaybackIfActive() runs it.
 */
export function armPlayback(steps: PlayStep[]): void {
  if (!steps || steps.length === 0) return;
  setState({ steps, index: 0, performed: 0 });
}

/** On (re)load: if a playback is mid-flight in this tab, resume it. */
export function resumePlaybackIfActive(): void {
  const state = getState();
  if (state && state.index < state.steps.length) {
    ensureOverlay();
    // Let the new page settle before resolving the next element.
    timer = window.setTimeout(run, 600);
  }
}

export function stopPlayback(): void {
  if (timer) window.clearTimeout(timer);
  const wasPreview = getState()?.returnToEdit;
  setState(null);
  unhighlight();
  overlay?.destroy();
  overlay = null;
  if (wasPreview) window.location.reload(); // back into the editor (restored from PENDING_EDIT)
}

// ===========================================================================
// Edit-record: "record from a selected point". Play the prefix [0..N] to reach
// the right app state, then the user clicks Record and we capture NEW steps
// (reusing the recorder's capture; the background routes them to a local edit
// session). On Stop they're spliced into the editor (PENDING_EDIT) and we reload
// so the editor reopens with the merged steps. Survives navigation throughout.
// ===========================================================================

let editBar: EditRecordBar | null = null;

/** Begin record-from-here: animate through the prefix, then offer "Record from here". */
export function startEditRecordPlayback(prefix: PlayStep[]): void {
  setState({ steps: prefix ?? [], index: 0, performed: 0, editRecord: true });
  ensureOverlay();
  run();
}

/** Arm record-from-here WITHOUT running — for navigating to the start page first; the
 *  next load's resumePlaybackIfActive() plays the prefix, then offers "Record from here". */
export function armEditRecordPlayback(prefix: PlayStep[]): void {
  setState({ steps: prefix ?? [], index: 0, performed: 0, editRecord: true });
}

/** Arm a Preview WITHOUT running — for navigating to the start page first. */
export function armPreview(steps: PlayStep[]): void {
  if (!steps || steps.length === 0) return;
  setState({ steps, index: 0, performed: 0, returnToEdit: true });
}

/** Prefix finished → show the "Record from here / Cancel" control. */
function showEditRecordPrompt(): void {
  editBar?.destroy();
  editBar = new EditRecordBar();
  editBar.prompt(beginEditRecord, finishEditRecord);
}

/** User clicked "Record from here" — start capturing new steps. */
async function beginEditRecord(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'helpdoit:editrec-begin' });
  } catch {
    /* ignore */
  }
  setOnStep((n) => editBar?.setCount(n));
  attachCapture();
  editBar?.recording(finishEditRecord);
}

/** Stop (or cancel) — splice captured steps into the editor and reopen it. */
async function finishEditRecord(): Promise<void> {
  setOnStep(null);
  detachCapture();
  try {
    await browser.runtime.sendMessage({ type: 'helpdoit:editrec-stop' });
  } catch {
    /* ignore */
  }
  editBar?.destroy();
  editBar = null;
  // Reload so the content script reopens the editor with the merged steps (PENDING_EDIT).
  window.location.reload();
}

/** On (re)load: if an edit-record capture is mid-flight in this tab, resume it. */
export async function resumeEditRecordIfActive(): Promise<void> {
  try {
    const res = (await browser.runtime.sendMessage({ type: 'helpdoit:editrec-status' })) as
      | { active?: boolean; recording?: boolean; count?: number }
      | undefined;
    if (res?.active && res.recording) {
      editBar?.destroy();
      editBar = new EditRecordBar();
      editBar.recording(finishEditRecord);
      editBar.setCount(res.count ?? 0);
      setOnStep((n) => editBar?.setCount(n));
      attachCapture();
    }
  } catch {
    /* ignore */
  }
}

/** A small bottom-center control bar for the record-from-here flow (its own shadow host). */
class EditRecordBar {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private label: HTMLSpanElement;
  private primary: HTMLButtonElement;
  private secondary: HTMLButtonElement;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-helpdoit-editrec', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483646;
          display: flex; align-items: center; gap: 12px; background: #0f766e; color: #fff; padding: 10px 16px;
          border-radius: 999px; box-shadow: 0 8px 28px rgba(0,0,0,.3); font-family: system-ui, sans-serif; font-size: 14px; }
        .bar button { border: none; border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .primary { background: #fff; color: #0f766e; }
        .secondary { background: rgba(255,255,255,.18); color: #fff; }
      </style>
      <div class="bar">
        <span class="label"></span>
        <button class="secondary" type="button"></button>
        <button class="primary" type="button"></button>
      </div>`;
    document.documentElement.appendChild(this.host);
    this.label = this.root.querySelector('.label')!;
    this.secondary = this.root.querySelector('.secondary')!;
    this.primary = this.root.querySelector('.primary')!;
  }

  prompt(onRecord: () => void, onCancel: () => void): void {
    this.label.textContent = 'Ready — record the next steps from here.';
    this.secondary.textContent = 'Cancel';
    this.secondary.onclick = onCancel;
    this.primary.textContent = '● Record from here';
    this.primary.onclick = onRecord;
  }

  recording(onStop: () => void): void {
    this.label.textContent = 'Recording new steps · 0';
    this.secondary.style.display = 'none';
    this.primary.textContent = '■ Stop';
    this.primary.onclick = onStop;
  }

  setCount(n: number): void {
    this.label.textContent = `Recording new steps · ${n}`;
  }

  destroy(): void {
    this.host.remove();
  }
}

function ensureOverlay(): void {
  if (!overlay) overlay = new PlaybackOverlay(stopPlayback);
}

function run(): void {
  try {
    runStep();
  } catch (e) {
    derror('playback error', e);
    overlay?.note('Playback hit an error — stopping.', true);
  }
}

function runStep(): void {
  const state = getState();
  if (!state) {
    dwarn('playback: no state');
    return;
  }
  if (state.index >= state.steps.length) {
    dlog('playback done, performed', state.performed, 'of', state.steps.length);
    // Preview: the editor stashed the in-progress edit — reload back into it.
    if (state.returnToEdit) {
      setState(null);
      unhighlight();
      overlay?.destroy();
      overlay = null;
      window.location.reload();
      return;
    }
    // Edit-record: the prefix finished — hand off to "record from here".
    if (state.editRecord) {
      setState(null);
      overlay?.destroy();
      overlay = null;
      showEditRecordPrompt();
      return;
    }
    overlay?.finish(state.performed);
    setState(null);
    window.setTimeout(
      () => {
        overlay?.destroy();
        overlay = null;
      },
      state.performed > 0 ? 2200 : 5000, // linger on a failure so the message is read
    );
    return;
  }

  const step = state.steps[state.index];
  const mode = reconcileMode(step.type, step.mode);
  dlog('playback step', state.index + 1, '/', state.steps.length, step.type, '·', step.caption, step.target);
  overlay?.caption(displayCaption(step, mode), state.index + 1, state.steps.length);

  // 'navigate' steps are transition markers (page changed as a side effect of the
  // prior click); junk steps are noise clicks with no usable locator. Skip both.
  if (step.type === 'navigate' || isJunkStep(step)) {
    dlog('playback: skipping', step.type === 'navigate' ? 'navigate' : 'junk', 'step');
    advance(state);
    timer = window.setTimeout(run, 150);
    return;
  }

  // `mode` was reconciled above (a typing step tagged 'pick' is a known mislabel —
  // we coerce it to 'input' so clicking into the field isn't treated as a choice).

  // A focus-click whose only job is to select a field that the very next step types
  // into is redundant: the input step focuses the field itself. Skip it so the field
  // input plays as one clean "type here" pause instead of an extra cursor hop.
  if ((step.type === 'click' || step.type === 'rightClick') && mode === 'auto') {
    const next = state.steps[state.index + 1];
    if (next && next.type === 'input' && sameTarget(step.target, next.target)) {
      dlog('playback: skipping focus-click that precedes typing into the same field');
      advance(state);
      timer = window.setTimeout(run, 120);
      return;
    }
  }

  // Interactive steps: pause and hand to the user instead of auto-performing.
  if (mode === 'input') {
    handleInput(state, step);
    return;
  }
  if (mode === 'pick') {
    handlePick(state, step);
    return;
  }

  resolve(step.target, RESOLVE_TRIES, (el) => {
    if (!el) {
      dwarn('playback: step not found', step.target);
      // Don't hang: note it loudly and move on so an imperfect recording still completes.
      overlay?.note(`Step ${state.index + 1}/${state.steps.length}: couldn't find this on the page — skipping`);
      advance(state);
      timer = window.setTimeout(run, 1600);
      return;
    }
    dlog('playback: resolved', el);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    window.setTimeout(() => {
      const { x, y } = pointIn(el, step.target?.offset);
      overlay!.moveTo(x, y, () => {
        overlay!.clickPulse();
        performAction(el, step);
        advance(state, true);
        // If the click navigated, this context dies and resume() continues on the
        // next page. If not, schedule the next step here.
        timer = window.setTimeout(run, STEP_PAUSE);
      });
    }, 320); // allow the smooth scroll to settle
  });
}

/**
 * Force the playback mode to match the step's action type — mirrors the server-side
 * guard so stale/mislabeled data (e.g. a typing step tagged 'pick') still plays right.
 * A typing step is only 'auto' or 'input'; a click/select/toggle is only 'auto' or 'pick'.
 */
function reconcileMode(type: PlayStep['type'], mode: PlayStep['mode']): 'auto' | 'input' | 'pick' {
  const m = mode ?? 'auto';
  if (type === 'navigate') return 'auto';
  if (type === 'input') return m === 'input' ? 'input' : m === 'pick' ? 'input' : 'auto';
  return m === 'pick' ? 'pick' : 'auto'; // click/select/toggle/rightClick: 'input' is meaningless here
}

/** The next step that has a real action (skipping navigate markers and junk clicks). */
function nextActionableStep(state: PlayState): PlayStep | undefined {
  for (let i = state.index + 1; i < state.steps.length; i++) {
    const s = state.steps[i];
    if (s.type === 'navigate' || isJunkStep(s)) continue;
    return s;
  }
  return undefined;
}

/** Has the given step's target rendered on the page yet (its element/choices present)? */
function targetRendered(step: PlayStep | undefined): boolean {
  if (!step || !step.target) return false;
  if (reconcileMode(step.type, step.mode) === 'pick') return findCandidates(step.target).length > 0;
  return !!findElement(step.target);
}

/** Do two steps target the same element (same selector, else same accessible label)? */
function sameTarget(a: StepTarget | undefined, b: StepTarget | undefined): boolean {
  if (!a || !b) return false;
  if (a.selector && b.selector && a.selector.trim() === b.selector.trim()) return true;
  const an = norm(a.name ?? a.text ?? '');
  const bn = norm(b.name ?? b.text ?? '');
  return an.length > 1 && an === bn;
}

function advance(state: PlayState, performed = false): void {
  setState({
    steps: state.steps,
    index: state.index + 1,
    performed: state.performed + (performed ? 1 : 0),
    // Preserve the flow flags — without these, after the first step the prefix would
    // finish as a plain playback ("Done") instead of handing off to record-from-here /
    // returning to the editor.
    editRecord: state.editRecord,
    returnToEdit: state.returnToEdit,
  });
}

// --- Interactive steps -----------------------------------------------------

/**
 * 'input': move to the field and let the user type their OWN value. Advancing is
 * hybrid — the explicit "Continue ▸" button is always available (and never gets
 * stuck), but we also auto-advance once typing has settled AND the next step's
 * target has rendered. Two independent confirmations guard against either signal
 * firing alone (type-ahead results appearing after the first keystroke, etc.).
 */
function handleInput(state: PlayState, step: PlayStep): void {
  resolve(step.target, RESOLVE_TRIES, (el) => {
    const prompt = step.prompt || 'Type your value, then Continue';
    const next = nextActionableStep(state);
    // An optional default the trainer set for this field. It is NOT pre-filled — the user
    // types their own value. It's only applied as a fallback if they click Continue having
    // left the field empty (so the next step still has something to act on). With no
    // default, Continue stays disabled until they type.
    const defaultValue = typeof step.value === 'string' ? step.value : '';
    const hasDefault = defaultValue.trim().length > 0;
    let idleTimer: number | undefined;
    let pollTimer: number | undefined;
    let advanced = false;

    const stopTimers = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      if (pollTimer) window.clearTimeout(pollTimer);
      idleTimer = pollTimer = undefined;
    };
    const currentValue = () => ((el as HTMLInputElement | HTMLTextAreaElement)?.value ?? '').trim();
    // Continue is usable when the user has typed a value OR there's a default to fall back on.
    const refreshContinue = () => overlay?.setActionEnabled(currentValue().length > 0 || hasDefault);
    const go = () => {
      if (advanced) return;
      if (el && currentValue().length === 0) {
        if (!hasDefault) return; // empty + no default → nothing to advance with
        setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, defaultValue); // apply the fallback now
      }
      advanced = true;
      stopTimers();
      if (el) {
        el.removeEventListener('input', onInput);
        el.removeEventListener('keydown', onKey as EventListener);
      }
      overlay?.hideAction();
      advance(state, true);
      timer = window.setTimeout(run, STEP_PAUSE); // let an applied default's search kick off
    };

    // After typing settles, the search request is still in flight — the next step's
    // target (e.g. the result rows) renders a beat later. So POLL for it for a few
    // seconds rather than checking once and giving up. Any new keystroke restarts this.
    const pollForNext = (left: number) => {
      if (advanced || !getState()) return;
      if (!currentValue()) return; // field was cleared (typed then backspaced) — wait for more input
      if (targetRendered(next)) {
        go();
        return;
      }
      if (left <= 0) return; // gave up auto-advancing; the Continue button still works
      pollTimer = window.setTimeout(() => pollForNext(left - 1), NEXT_POLL_MS);
    };
    const onInput = () => {
      refreshContinue(); // enable/disable Continue as the user types or clears the field
      stopTimers();
      idleTimer = window.setTimeout(() => {
        if (advanced || !getState() || !currentValue()) return; // need a non-empty value
        if (!next) {
          go(); // no downstream target to wait for (terminal input) — accept the typed value
          return;
        }
        pollForNext(NEXT_POLL_TRIES);
      }, TYPING_IDLE_MS);
    };
    // Enter is the natural "done typing" gesture for a search/entry field.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && currentValue().length > 0) go();
    };

    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      window.setTimeout(() => {
        const { x, y } = pointIn(el, step.target?.offset);
        overlay!.moveTo(x, y, () => {
          try {
            el.focus();
          } catch {
            /* ignore */
          }
          el.addEventListener('input', onInput);
          el.addEventListener('keydown', onKey as EventListener);
          // Anchor the button near the field (not pinned top-center) so it's discoverable.
          overlay!.awaitAction(prompt, 'Continue ▸', go, true);
          // Field starts empty; Continue is enabled only if there's a default to fall back on.
          refreshContinue();
        });
      }, 320);
      return;
    }
    // No field found — manual Continue only (nothing to gate on).
    overlay?.awaitAction(prompt, 'Continue ▸', go);
  });
}

/**
 * 'pick': highlight the matching choices and wait for the user to click one.
 *
 * We only advance when the click actually lands on an expected choice — an errant
 * click on page chrome / whitespace is ignored (with a gentle nudge), not treated as
 * satisfying the step. When the recorded choices can't be resolved at all (label
 * drift, async results), we accept a click on a *plausible* interactive control as a
 * fallback rather than accepting any click anywhere. A short suppression window after a
 * satisfying click swallows the trailing click of a double-click so it can't also
 * satisfy the next step.
 */
function handlePick(state: PlayState, step: PlayStep): void {
  const prompt = step.prompt || 'Click the item you want';
  const hoverable = isHoverable(step.target); // a submenu-opening menu item satisfies on hover too
  let tries = RESOLVE_TRIES;
  let satisfied = false;
  let dwellTimer: number | undefined;

  let pointed = false;
  const attempt = () => {
    if (!getState() || satisfied) return; // stopped or already picked
    const candidates = findCandidates(step.target);
    highlight(candidates);
    if (candidates[0] && !pointed) {
      pointed = true;
      // Scroll the choice into view first (it may be below the fold, esp. after a
      // navigation), THEN point the cursor at its settled position.
      const choice = candidates[0]; // the BEST (tightest) candidate
      choice.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      window.setTimeout(() => {
        if (!getState() || satisfied) return;
        const { x, y } = pointIn(choice, { rx: 0.5, ry: 0.5 });
        overlay?.moveTo(x, y, () => {});
      }, 320);
    }
    if (candidates.length === 0 && tries-- > 0) {
      // Keep waiting for the expected choices to render — don't fall back to "accept any".
      overlay?.note(`${prompt}\n(waiting for the choices to appear…)`, false);
      timer = window.setTimeout(attempt, 250);
      return;
    }
    overlay?.note(prompt, false);
  };

  const clearDwell = () => {
    if (dwellTimer) window.clearTimeout(dwellTimer);
    dwellTimer = undefined;
  };
  // Listen at the WINDOW in capture phase — the earliest point, before any page handler,
  // so the page can't preempt us. pointerdown + click both, since Radix dropdowns open on
  // pointerdown and suppress the click. pointermove only when hover can satisfy the step.
  const teardown = () => {
    window.removeEventListener('pointerdown', onPick, true);
    window.removeEventListener('click', onPick, true);
    window.removeEventListener('pointermove', onMove, true);
    clearDwell();
  };
  const accept = () => {
    if (satisfied) return;
    satisfied = true;
    suppressClicksUntil = Date.now() + 700; // swallow a trailing click/double-click into the next step
    teardown();
    unhighlight();
    advance(state, true); // persist BEFORE the click's own navigation, so resume continues
    timer = window.setTimeout(run, STEP_PAUSE); // (no-op if the click navigated)
  };

  const onPick = (e: Event) => {
    if (!getState()) {
      teardown();
      unhighlight();
      return;
    }
    if (satisfied || Date.now() < suppressClicksUntil) return; // debounce one interaction → one step
    const path = (e.composedPath?.() ?? []) as EventTarget[];
    const target = (e.target as HTMLElement) ?? null;
    const candidates = findCandidates(step.target); // re-resolve live (menus re-render)
    const pt = pointerCoords(e);
    // Accept when the interaction lands on a choice — by DOM containment OR by geometric
    // hit-test of the pointer against the choice's live rect (robust to re-rendered nodes) —
    // else a genuine interactive control as a fallback. Only empty page chrome is rejected.
    const onChoice =
      candidates.some((c) => path.includes(c) || c.contains(target)) ||
      (pt != null && withinAny(candidates, pt.x, pt.y));
    if (onChoice || isPlausibleChoice(target, step.target)) {
      accept();
    } else {
      overlay?.note(`${prompt}\n(click one of the highlighted items)`, true);
    }
  };

  // Hover-to-satisfy (gated): only for submenu-opening items, and only after a short dwell
  // inside the choice — so merely passing the cursor through doesn't auto-advance.
  const onMove = (e: Event) => {
    if (satisfied || !getState() || Date.now() < suppressClicksUntil) return;
    const pt = pointerCoords(e);
    // Hit-test the cheap, already-highlighted candidates (avoid re-resolving on every move).
    const inside = pt != null && withinAny(highlighted.map((h) => h.el), pt.x, pt.y);
    if (inside && dwellTimer == null) {
      dwellTimer = window.setTimeout(() => {
        if (!satisfied && getState()) accept();
      }, 350);
    } else if (!inside) {
      clearDwell();
    }
  };

  window.addEventListener('pointerdown', onPick, true);
  window.addEventListener('click', onPick, true);
  if (hoverable) window.addEventListener('pointermove', onMove, true);
  attempt();
}

/** Pointer coordinates from a mouse/pointer event, or null for non-pointer events. */
function pointerCoords(e: Event): { x: number; y: number } | null {
  const me = e as MouseEvent;
  return typeof me.clientX === 'number' && (me.clientX !== 0 || me.clientY !== 0)
    ? { x: me.clientX, y: me.clientY }
    : null;
}

/** Do the coords fall within any candidate's live bounding rect? */
function withinAny(els: HTMLElement[], x: number, y: number): boolean {
  return els.some((el) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
}

/** A submenu-opening menu item — satisfies on hover (matches "Click or hover"). */
function isHoverable(target: StepTarget | undefined): boolean {
  const top = target?.hierarchy?.[0];
  if (!top?.haspopup) return false;
  const role = (top.role ?? '').toLowerCase();
  return role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox';
}

/** Interactive controls a user would actually click to make a choice. */
const PICKABLE_SELECTOR =
  'a,button,[role=button],[role=option],[role=menuitem],[role=menuitemradio],[role=link],[role=row],[role=gridcell],input,select,textarea,label,[onclick],[tabindex]';

/**
 * A fallback gate for when the recorded choices couldn't be resolved: is the clicked
 * node a real, clickable choice (interactive control, matches the recorded tag, or has a
 * pointer cursor) rather than empty page chrome?
 */
function isPlausibleChoice(target: HTMLElement | null, want: StepTarget | undefined): boolean {
  if (!target) return false;
  const interactive = target.closest?.(PICKABLE_SELECTOR) as HTMLElement | null;
  if (interactive) return true;
  const wantTag = want?.hierarchy?.[0]?.tag?.toLowerCase();
  if (wantTag && wantTag !== 'html' && wantTag !== 'body' && target.tagName.toLowerCase() === wantTag) return true;
  try {
    if (getComputedStyle(target).cursor === 'pointer') return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** The user's candidate choices for a pick step — scored, best-first (for highlight + accept). */
function findCandidates(target: StepTarget | undefined): HTMLElement[] {
  return resolveTarget(target).ranked;
}

let highlighted: { el: HTMLElement; outline: string; offset: string }[] = [];
function highlight(els: HTMLElement[]): void {
  unhighlight();
  highlighted = els.map((el) => {
    const prev = { el, outline: el.style.outline, offset: el.style.outlineOffset };
    el.style.outline = '2px solid #0d9488';
    el.style.outlineOffset = '2px';
    return prev;
  });
}
function unhighlight(): void {
  for (const h of highlighted) {
    h.el.style.outline = h.outline;
    h.el.style.outlineOffset = h.offset;
  }
  highlighted = [];
}

/** Resolve a step's element via the scored resolver, waiting until it's actionable. Retries. */
function resolve(target: StepTarget | undefined, tries: number, cb: (el: HTMLElement | null) => void): void {
  if (!target) {
    cb(null);
    return;
  }
  const attempt = (left: number) => {
    const el = findElement(target);
    if ((el && actionable(el)) || left <= 0) {
      cb(el);
      return;
    }
    window.setTimeout(() => attempt(left - 1), 200);
  };
  attempt(tries);
}

/** A step with no replayable locator (a noise click on the page root, or no hints). */
function isJunkStep(step: PlayStep): boolean {
  const t = step.target;
  if (!t) return true;
  const tag = t.hierarchy?.[0]?.tag?.toLowerCase();
  if (tag === 'html' || tag === 'body') return true;
  const hasSelector = !!t.selector && t.selector.trim().length > 0;
  const hasLabel = !!(t.name?.trim() || t.text?.trim());
  return !hasSelector && !hasLabel;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The best live element for a step, via the scored semantic resolver. */
function findElement(target: StepTarget): HTMLElement | null {
  return resolveTarget(target).best;
}

function pointIn(el: HTMLElement, offset?: { rx: number; ry: number }): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const rx = offset?.rx ?? 0.5;
  const ry = offset?.ry ?? 0.5;
  return { x: r.left + r.width * rx, y: r.top + r.height * ry };
}

/** Perform the step's action on the resolved element (click / right-click / type / select / toggle). */
function performAction(el: HTMLElement, step: PlayStep): void {
  switch (step.type) {
    case 'input':
      setNativeValue(el as HTMLInputElement, String(step.value ?? ''));
      return;
    case 'select':
      performSelect(el, step);
      return;
    case 'toggle':
    case 'click':
    case 'rightClick':
    default:
      performClick(el, step.type === 'rightClick' ? 'rightClick' : 'click');
  }
}

/** Dispatch a realistic click (or context menu) so the page's handlers fire. */
function performClick(el: HTMLElement, type: 'click' | 'rightClick'): void {
  const r = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    view: window,
  } as MouseEventInit;
  if (type === 'rightClick') {
    el.dispatchEvent(new MouseEvent('contextmenu', { ...base, button: 2 }));
    return;
  }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', base));
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', base));
  el.dispatchEvent(new MouseEvent('click', base));
  if (typeof el.click === 'function') el.click(); // native activation fallback
}

/** Set a field's value the React-safe way (native setter), then fire input + change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Choose an option on a native <select>; for custom comboboxes, fall back to a click. */
function performSelect(el: HTMLElement, step: PlayStep): void {
  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options);
    const want = String(step.value ?? '');
    const match =
      opts.find((o) => o.value === want) ??
      opts.find((o) => o.text.trim() === (step.label ?? '').trim());
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
  performClick(el, 'click');
}

/**
 * The tip shown for a step. An explicit caption wins. Otherwise, for INTERACTIVE steps
 * (input/pick) we show the prompt — never the recorded value: in input mode the user
 * types their OWN value, so echoing the recorded literal (e.g. Type "test") is wrong.
 * Only auto steps fall back to captionFor (which may name the recorded value, correctly,
 * since auto steps replay it verbatim).
 */
function displayCaption(step: PlayStep, mode: 'auto' | 'input' | 'pick'): string {
  const caption = step.caption?.trim();
  if (caption) return caption;
  if (mode === 'input') return step.prompt?.trim() || 'Type your value, then Continue';
  if (mode === 'pick') return step.prompt?.trim() || captionFor(step);
  return captionFor(step);
}

function captionFor(step: PlayStep): string {
  switch (step.type) {
    case 'navigate':
      return 'Going to the next page…';
    case 'input':
      return step.value ? `Type "${step.value}"` : 'Type here';
    case 'select':
      return step.label ? `Choose "${step.label}"` : 'Choose an option';
    case 'toggle':
      return `Toggle "${step.target?.name || step.target?.text || ''}"`.trim();
    default: {
      const t = step.target?.name || step.target?.text?.trim();
      return t ? `Click "${t}"` : 'Click here';
    }
  }
}

/**
 * The on-page overlay: a simulated cursor, a caption tooltip, and a Stop button.
 * Lives in its own shadow root attached to <html> so page CSS can't touch it and it
 * sits above everything. Pointer-events are off except the Stop button.
 */
class PlaybackOverlay {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private cursor: HTMLDivElement;
  private tip: HTMLDivElement;
  private noteEl!: HTMLDivElement;
  private actBtn!: HTMLButtonElement;
  private x = window.innerWidth - 90;
  private y = window.innerHeight - 90;

  constructor(onStop: () => void) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-helpdoit-playback', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>
        :host { all: initial; }
        .layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; font-family: system-ui, sans-serif; }
        .cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; transform: translate(${this.x}px, ${this.y}px);
          transition: transform ${MOVE_MS}ms cubic-bezier(.4,.1,.2,1); will-change: transform; }
        .cursor svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
        .ring { position: fixed; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
          border: 3px solid #0d9488; opacity: 0; }
        .ring.go { animation: pulse .5s ease-out; }
        @keyframes pulse { 0% { opacity:.9; transform: translate(var(--x),var(--y)) scale(.3);} 100% { opacity:0; transform: translate(var(--x),var(--y)) scale(1.1);} }
        .tip { position: fixed; max-width: 260px; background: #0f766e; color: #fff; padding: 8px 12px; border-radius: 10px;
          font-size: 13px; line-height: 1.35; box-shadow: 0 6px 20px rgba(0,0,0,.25); white-space: pre-wrap; opacity: 0;
          transition: opacity .2s, transform .2s; transform: translateY(4px); }
        .tip.show { opacity: 1; transform: translateY(0); }
        .stop { position: fixed; top: 16px; right: 16px; pointer-events: auto; background: #fff; color: #b91c1c;
          border: 1px solid #b91c1c; border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
          box-shadow: 0 4px 14px rgba(0,0,0,.18); }
        .badge { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: none; background: #0d9488;
          color: #fff; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
        .note { position: fixed; top: 52px; left: 50%; transform: translateX(-50%); pointer-events: none; max-width: 70vw;
          text-align: center; background: rgba(15,118,110,.97); color: #fff; border-radius: 10px; padding: 8px 14px; font-size: 13px;
          line-height: 1.35; box-shadow: 0 6px 20px rgba(0,0,0,.25); opacity: 0; transition: opacity .2s; }
        .note.show { opacity: 1; }
        .note.warn { background: rgba(180,83,9,.97); }
        .act { position: fixed; top: 92px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: none;
          background: #0f766e; color: #fff; border: none; border-radius: 999px; padding: 9px 20px; font-size: 14px;
          font-weight: 700; cursor: pointer; box-shadow: 0 6px 20px rgba(15,118,110,.45); font-family: system-ui, sans-serif; }
        .act.pulse { animation: actpulse 1.6s ease-in-out infinite; }
        .act:disabled { opacity: .45; cursor: not-allowed; animation: none; box-shadow: 0 6px 20px rgba(15,118,110,.25); }
        @keyframes actpulse { 0%,100% { box-shadow: 0 6px 20px rgba(15,118,110,.45);} 50% { box-shadow: 0 6px 26px rgba(15,118,110,.85), 0 0 0 6px rgba(15,118,110,.18);} }
      </style>
      <div class="layer">
        <div class="badge" part="badge"></div>
        <div class="note"></div>
        <button class="act" type="button"></button>
        <div class="ring"></div>
        <div class="cursor">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="#0d9488" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 2l14 7-6 2-2 6-6-15z"/>
          </svg>
        </div>
        <div class="tip"></div>
        <button class="stop" type="button">■ Stop</button>
      </div>`;
    document.documentElement.appendChild(this.host);
    this.cursor = this.root.querySelector('.cursor')!;
    this.tip = this.root.querySelector('.tip')!;
    this.noteEl = this.root.querySelector('.note')!;
    this.actBtn = this.root.querySelector('.act')!;
    this.root.querySelector('.stop')!.addEventListener('click', onStop);
  }

  /**
   * Pause with a prompt + a button (e.g. "Continue") that resolves when clicked.
   * When {@code anchorToCursor} is set, the button floats just below the cursor/field
   * (so it's where the user is looking) instead of being pinned top-center.
   */
  awaitAction(text: string, label: string, onClick: () => void, anchorToCursor = false): void {
    this.note(text, false);
    this.actBtn.textContent = label;
    if (anchorToCursor) {
      this.actBtn.style.left = `${Math.min(Math.max(12, this.x + 18), window.innerWidth - 170)}px`;
      this.actBtn.style.top = `${Math.min(Math.max(12, this.y + 56), window.innerHeight - 52)}px`;
      this.actBtn.style.removeProperty('transform');
    } else {
      this.actBtn.style.left = '50%';
      this.actBtn.style.top = '92px';
      this.actBtn.style.transform = 'translateX(-50%)';
    }
    this.actBtn.style.display = 'inline-block';
    this.actBtn.disabled = false;
    this.actBtn.classList.add('pulse');
    // Don't steal focus from the field on press — that would blur the search box and
    // close its autocomplete, hiding the result rows the next (pick) step needs.
    this.actBtn.onmousedown = (e) => e.preventDefault();
    this.actBtn.onclick = () => {
      this.hideAction();
      onClick();
    };
  }

  /** Enable/disable the action button (e.g. gate Continue until the field has a value). */
  setActionEnabled(on: boolean): void {
    this.actBtn.disabled = !on;
    this.actBtn.classList.toggle('pulse', on); // no attention-pulse while it can't be used
  }

  /** Hide the action button (on click or when typing auto-advances the step). */
  hideAction(): void {
    this.actBtn.style.display = 'none';
    this.actBtn.classList.remove('pulse');
  }

  moveTo(x: number, y: number, done: () => void): void {
    this.x = x;
    this.y = y;
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
    this.positionTip(x, y);
    window.setTimeout(done, MOVE_MS + 60);
  }

  clickPulse(): void {
    const ring = this.root.querySelector<HTMLDivElement>('.ring')!;
    ring.style.setProperty('--x', `${this.x}px`);
    ring.style.setProperty('--y', `${this.y}px`);
    ring.classList.remove('go');
    void ring.offsetWidth; // reflow to restart the animation
    ring.classList.add('go');
  }

  caption(text: string, n: number, total: number): void {
    this.tip.textContent = text;
    this.tip.classList.add('show');
    this.positionTip(this.x, this.y);
    (this.root.querySelector('.badge') as HTMLElement).textContent = `Step ${n} of ${total}`;
    // Mirror the current action top-center too, where it's always visible.
    this.note(text, false);
  }

  /** A prominent top-center status line (live action, skip notices, outcome). */
  note(text: string, warn = false): void {
    this.noteEl.textContent = text;
    this.noteEl.classList.toggle('warn', warn);
    this.noteEl.classList.add('show');
  }

  finish(performed: number): void {
    const badge = this.root.querySelector('.badge') as HTMLElement;
    this.tip.classList.remove('show');
    if (performed > 0) {
      badge.textContent = '✓ Done';
      this.note("That's it — walkthrough complete.", false);
    } else {
      badge.textContent = 'Couldn’t replay';
      this.note(
        "I couldn't find these steps on this page. The walkthrough may have been recorded from a different starting point — try re-recording it.",
        true,
      );
    }
  }

  private positionTip(x: number, y: number): void {
    const below = y + 200 < window.innerHeight;
    this.tip.style.left = `${Math.min(Math.max(12, x + 18), window.innerWidth - 280)}px`;
    this.tip.style.top = `${below ? y + 22 : y - 70}px`;
  }

  destroy(): void {
    this.host.remove();
  }
}
