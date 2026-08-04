import { browser } from 'wxt/browser';

export interface RecState {
  recording: boolean;
  walkthroughId?: string;
  captureScreens: boolean;
  stepCount: number;
}

const WIDGET_TAG = 'HELPDOIT-WIDGET';

let attached = false;
let onStep: ((count: number) => void) | null = null;

/** Subscribe to live step-count updates (the widget shows the counter). */
export function setOnStep(cb: ((count: number) => void) | null): void {
  onStep = cb;
}

/** Don't record interactions with our own widget (it lives in a shadow host). */
function isInsideWidget(e: Event): boolean {
  const path = (e.composedPath?.() ?? []) as EventTarget[];
  return path.some((n) => (n as HTMLElement)?.tagName === WIDGET_TAG);
}

/** Short, stable-ish hints for one element. */
function describeNode(el: Element): Record<string, unknown> {
  const h: Record<string, unknown> = { tag: el.tagName.toLowerCase() };
  if (el.id) h.id = el.id;
  const testid = el.getAttribute('data-testid');
  if (testid) h.testid = testid;
  const role = el.getAttribute('role');
  if (role) h.role = role;
  const aria = el.getAttribute('aria-label');
  if (aria) h.aria = aria;
  // Signals that this control opens a menu/dropdown (custom combobox, not <select>),
  // so the AI can caption it "Open the … menu" rather than a bare "Click".
  const haspopup = el.getAttribute('aria-haspopup');
  if (haspopup) h.haspopup = haspopup;
  const expanded = el.getAttribute('aria-expanded');
  if (expanded != null) h.expanded = expanded;
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) h.placeholder = placeholder;
  const cls = (el.getAttribute('class') || '').trim();
  if (cls) h.classes = cls.split(/\s+/).slice(0, 4);
  return h;
}

/** Best-effort CSS path: id / data-testid short-circuit; else tag:nth-of-type up the tree. */
function cssPath(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
    let part = node.tagName.toLowerCase();
    const testid = node.getAttribute('data-testid');
    if (testid) {
      parts.unshift(`${part}[data-testid="${CSS.escape(testid)}"]`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    if (node.id) {
      parts[0] = `#${CSS.escape(node.id)}`;
      break;
    }
    node = parent;
  }
  return parts.join(' > ');
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Elements that represent a real, replayable control (a click "means" one of these). */
const INTERACTIVE =
  'a[href],button,input,select,textarea,label,summary,option,' +
  '[role=button],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],' +
  '[role=option],[role=tab],[role=link],[role=checkbox],[role=radio],[role=switch],' +
  '[role=combobox],[role=listbox],[aria-haspopup],[aria-expanded],[tabindex]';

/**
 * Resolve a raw event target to the control the user actually meant. Clicks often
 * land on an icon/span inside a button; climb to the nearest interactive ancestor
 * so the step gets a real locator + accessible name (and the AI a strong signal).
 */
function interactiveTarget(el: Element): Element {
  let node: Element | null = el;
  for (let i = 0; node && node.nodeType === 1 && i < 8; i++) {
    if (node.matches?.(INTERACTIVE)) return node;
    node = node.parentElement;
  }
  return el;
}

/** A human-meaningful label for the element — what the AI captions and playback match on. */
function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (text) return text.slice(0, 80);
  }
  // NB: NOT the `name` attribute — it's a machine id (e.g. "quick-search-select"),
  // not a human label, and pollutes both captions and playback matching.
  for (const attr of ['title', 'alt', 'placeholder']) {
    const v = el.getAttribute(attr);
    if (v?.trim()) return v.trim().slice(0, 80);
  }
  const text = (el.textContent || '').trim();
  return text ? text.slice(0, 80) : '';
}

/**
 * A distinguishing text token from the element's enclosing row/container (table row, list
 * item, or a repeated sibling), minus the element's own label. Lets playback pick the right
 * row when a control (e.g. "Start Order") repeats per item. Undefined when there's no row.
 */
function rowAnchor(el: Element): { text: string } | undefined {
  const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
  let node: Element | null = el.parentElement;
  for (let i = 0; node && i < 8; i++, node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute('role');
    const repeated =
      !!node.parentElement &&
      Array.from(node.parentElement.children).filter((c) => c.tagName === node!.tagName).length >= 2;
    const isRow =
      tag === 'tr' || tag === 'li' || role === 'row' || role === 'option' || role === 'listitem' || repeated;
    if (!isRow) continue;
    const full = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const rest = own ? full.replace(own, ' ').replace(/\s+/g, ' ').trim() : full;
    const token = (rest || full).slice(0, 60);
    return token.length >= 2 ? { text: token } : undefined;
  }
  return undefined;
}

/**
 * Full locator for an element. Identified by {@link cssPath selector} + ancestor
 * hierarchy + text + accessible {@link accessibleName name} (all resolution-
 * independent) — what playback re-resolves against. The click point is stored as a
 * FRACTION (offset.rx/ry, 0..1), not pixels. {@code point} is omitted for non-click
 * steps (typing/selecting), defaulting to the element centre.
 */
function describeTarget(el: Element, point?: { x: number; y: number }) {
  const hierarchy: Record<string, unknown>[] = [];
  let node: Element | null = el;
  for (let i = 0; node && node.nodeType === 1 && i < 5; i++) {
    hierarchy.push(describeNode(node));
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  const offset =
    point && rect.width && rect.height
      ? {
          rx: Math.round(clamp01((point.x - rect.left) / rect.width) * 1000) / 1000,
          ry: Math.round(clamp01((point.y - rect.top) / rect.height) * 1000) / 1000,
        }
      : { rx: 0.5, ry: 0.5 };
  const anchor = rowAnchor(el);
  return {
    selector: cssPath(el),
    hierarchy,
    text: (el.textContent || '').trim().slice(0, 80),
    name: accessibleName(el),
    offset,
    capturedRect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
    capturedViewport: { w: window.innerWidth, h: window.innerHeight },
    ...(anchor ? { anchor } : {}),
  };
}

/** Send any typed step to the background (over RSocket) + request a screenshot. */
async function emitStep(step: Record<string, unknown>): Promise<void> {
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'helpdoit:rec-step',
      payload: { step, needScreenshot: true },
    })) as { ok: boolean; stepCount?: number } | undefined;
    if (res?.ok && typeof res.stepCount === 'number') onStep?.(res.stepCount);
  } catch {
    /* background momentarily unavailable — skip this step */
  }
}

// Dedup so a control captured on pointerdown isn't re-recorded by the trailing click.
let lastKey = '';
let lastAt = 0;

async function recordClick(el: Element, type: 'click' | 'rightClick', point: { x: number; y: number }): Promise<void> {
  const tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body') return; // no usable control
  await flushInput(); // any in-progress typing becomes its own step BEFORE this click
  const key = cssPath(el) + '|' + accessibleName(el);
  const now = Date.now();
  if (key === lastKey && now - lastAt < 700) return; // same control just recorded (pointerdown→click)
  lastKey = key;
  lastAt = now;
  await emitStep({
    type,
    at: new Date().toISOString(),
    url: location.href,
    title: document.title,
    target: describeTarget(el, point),
  });
}

// --- Typed input is COALESCED: keystrokes in one field collapse to a single step.
// A live-search box re-renders per keystroke, so we debounce and emit the final value
// on idle / Enter / blur / the next action — not "c" then "9d" for "c9d".
let pendingInput: { el: HTMLElement; value: string; point: { x: number; y: number } } | null = null;
let inputTimer: number | undefined;

function flushInput(): Promise<void> {
  if (inputTimer) {
    clearTimeout(inputTimer);
    inputTimer = undefined;
  }
  const p = pendingInput;
  pendingInput = null;
  if (!p || !p.value) return Promise.resolve();
  return emitStep({
    type: 'input',
    at: new Date().toISOString(),
    url: location.href,
    title: document.title,
    value: p.value.slice(0, 200),
    target: describeTarget(p.el, p.point),
  });
}

function onInput(e: Event): void {
  if (isInsideWidget(e)) return;
  const el = e.target as (HTMLInputElement | HTMLTextAreaElement) | null;
  if (!el || el.nodeType !== 1) return;
  const tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return;
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  if (type === 'password' || type === 'checkbox' || type === 'radio') return;
  const r = el.getBoundingClientRect();
  pendingInput = { el, value: el.value || '', point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = window.setTimeout(() => void flushInput(), 900); // idle → commit the field
}

/** select option / checkbox / radio commit on `change` — record those discretely. */
async function onChange(e: Event): Promise<void> {
  if (isInsideWidget(e)) return;
  const el = e.target as (HTMLInputElement | HTMLSelectElement) | null;
  if (!el || el.nodeType !== 1) return;
  const tag = el.tagName.toLowerCase();
  const base = { at: new Date().toISOString(), url: location.href, title: document.title };
  if (tag === 'select') {
    await flushInput();
    const sel = el as HTMLSelectElement;
    const label = sel.options[sel.selectedIndex]?.text?.trim() ?? sel.value;
    await emitStep({ ...base, type: 'select', value: sel.value, label, target: describeTarget(sel) });
  } else if (tag === 'input') {
    const t = ((el as HTMLInputElement).type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio') {
      await emitStep({ ...base, type: 'toggle', value: (el as HTMLInputElement).checked, target: describeTarget(el) });
    }
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !isInsideWidget(e)) void flushInput(); // commit the search term
}
function onBlurCapture(e: Event): void {
  if (pendingInput && e.target === pendingInput.el) void flushInput();
}

function onClick(e: MouseEvent) {
  if (isInsideWidget(e)) return;
  const raw = e.target as Element | null;
  if (raw?.nodeType === 1) recordClick(interactiveTarget(raw), 'click', { x: e.clientX, y: e.clientY });
}
function onContext(e: MouseEvent) {
  if (isInsideWidget(e)) return;
  const raw = e.target as Element | null;
  if (raw?.nodeType === 1) recordClick(interactiveTarget(raw), 'rightClick', { x: e.clientX, y: e.clientY });
}
/**
 * Many controls (dropdown/menu triggers especially) act on pointerdown and never
 * fire a click we'd catch. Record any genuinely interactive control here; a real
 * click that follows is deduped. Non-interactive targets are left to {@link onClick}.
 */
function onPointerDown(e: PointerEvent) {
  if (isInsideWidget(e)) return;
  const raw = e.target as Element | null;
  if (raw?.nodeType !== 1) return;
  const el = interactiveTarget(raw);
  if (el.matches?.(INTERACTIVE)) recordClick(el, 'click', { x: e.clientX, y: e.clientY });
}

function attach(): void {
  if (attached) return;
  // Capture phase so we see the event before the page handles/navigates.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onContext, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('blur', onBlurCapture, true);
  attached = true;
}
function detach(): void {
  if (!attached) return;
  void flushInput(); // capture any trailing typed value before we stop
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('contextmenu', onContext, true);
  document.removeEventListener('change', onChange, true);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('blur', onBlurCapture, true);
  attached = false;
}

/** Attach/detach the capture listeners directly — used by edit-record (record-from-here),
 *  which reuses the same capture but routes steps to a local edit session, not a walkthrough. */
export function attachCapture(): void {
  attach();
}
export function detachCapture(): void {
  detach();
}

export async function startRecording(opts: {
  questionId?: string;
  captureScreens: boolean;
}): Promise<RecState> {
  const res = (await browser.runtime.sendMessage({
    type: 'helpdoit:rec-start',
    payload: { questionId: opts.questionId, captureScreens: opts.captureScreens },
  })) as { ok: boolean; walkthroughId?: string; error?: string } | undefined;
  if (!res?.ok) throw new Error(res?.error ?? 'Could not start recording');
  attach();
  return {
    recording: true,
    walkthroughId: res.walkthroughId,
    captureScreens: opts.captureScreens,
    stepCount: 0,
  };
}

/** Result of Stop: a review draft (generated answer + captioned steps), not yet saved. */
export interface StopResult {
  stepCount: number;
  walkthroughId?: string;
  answer?: string;
  steps?: string; // JSON string of the captioned step array
}

/** Stop recording → summarize into a review draft (the trainer reviews, then saves). */
export async function stopRecording(opts?: { question?: string }): Promise<StopResult> {
  const res = (await browser.runtime.sendMessage({
    type: 'helpdoit:rec-stop',
    payload: { question: opts?.question },
  })) as { ok: boolean; stepCount?: number; walkthroughId?: string; answer?: string; steps?: string } | undefined;
  detach();
  return {
    stepCount: res?.stepCount ?? 0,
    walkthroughId: res?.walkthroughId,
    answer: res?.answer,
    steps: res?.steps,
  };
}

/** Regenerate the draft answer from edited step captions (review editor). */
export async function resummarizeAnswer(payload: {
  question?: string;
  steps?: string;
}): Promise<{ ok: boolean; answer?: string; error?: string }> {
  const res = (await browser.runtime.sendMessage({ type: 'helpdoit:rec-resummarize', payload })) as
    | { ok: boolean; answer?: string; error?: string }
    | undefined;
  return { ok: !!res?.ok, answer: res?.answer, error: res?.error };
}

/** Save the reviewed walkthrough as knowledge (edited answer + edited steps). */
export async function saveWalkthrough(payload: {
  walkthroughId: string;
  question?: string;
  tags?: string[];
  answer?: string;
  steps?: string;
}): Promise<{ ok: boolean; knowledgeEntryId?: string; error?: string }> {
  const res = (await browser.runtime.sendMessage({ type: 'helpdoit:rec-save', payload })) as
    | { ok: boolean; result?: { knowledgeEntryId?: string }; error?: string }
    | undefined;
  return { ok: !!res?.ok, knowledgeEntryId: res?.result?.knowledgeEntryId, error: res?.error };
}

/** On (re)load: if this tab is mid-recording, re-attach listeners and return state. */
export async function resumeIfRecording(): Promise<RecState | null> {
  const res = (await browser.runtime.sendMessage({ type: 'helpdoit:rec-status' })) as
    | { ok: boolean; recording: boolean; walkthroughId?: string; captureScreens: boolean; stepCount: number }
    | undefined;
  if (res?.recording) {
    attach();
    return {
      recording: true,
      walkthroughId: res.walkthroughId,
      captureScreens: res.captureScreens,
      stepCount: res.stepCount,
    };
  }
  return null;
}
