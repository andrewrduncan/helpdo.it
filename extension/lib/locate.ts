/**
 * Semantic, scored element resolution for playback. The recorder captures rich locator
 * data per step (accessible name, text, role/testid/aria on each hierarchy node, the CSS
 * path, and the captured rect/viewport). Replaying reliably is mostly about *resolving*
 * the recorded target back to the right live element — apps re-render, ids are dynamic
 * (radix), and the same label appears in several places.
 *
 * Rather than first-match selector→name→text, we gather candidates from several strategies
 * and SCORE them: stable testid and role+name dominate; an optional anchor (a row's
 * distinguishing text) selects the right item in a list; the recorded position and box
 * tightness break ties. Returns the best element plus the ranked list (for pick highlight).
 */

export interface NodeHint {
  tag?: string;
  id?: string;
  testid?: string;
  role?: string;
  aria?: string;
  haspopup?: string;
  expanded?: string;
  placeholder?: string;
  classes?: string[];
}

export interface LocatorTarget {
  selector?: string;
  name?: string;
  text?: string;
  hierarchy?: NodeHint[];
  offset?: { rx: number; ry: number };
  capturedRect?: { x: number; y: number; w: number; h: number };
  capturedViewport?: { w: number; h: number };
  /** A distinguishing text token from the recorded element's row/container — for list selection. */
  anchor?: { text?: string };
}

export interface ResolveResult {
  best: HTMLElement | null;
  ranked: HTMLElement[];
  score: number;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

export function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Visible, enabled, not aria-hidden — safe to act on / accept a click for. */
export function actionable(el: HTMLElement): boolean {
  if (!visible(el)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  return true;
}

/** The element's accessible name — mirrors recorder.accessibleName (never the machine `name` attr). */
export function liveName(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return norm(aria).slice(0, 80);
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (t.trim()) return norm(t).slice(0, 80);
  }
  for (const attr of ['title', 'alt', 'placeholder']) {
    const v = el.getAttribute(attr);
    if (v?.trim()) return norm(v).slice(0, 80);
  }
  return norm(el.textContent).slice(0, 80);
}

/** ARIA role: explicit, else implicit from the tag. */
export function roleOf(el: HTMLElement): string {
  const r = el.getAttribute('role');
  if (r) return r.toLowerCase();
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'button':
    case 'summary':
      return 'button';
    case 'a':
      return el.hasAttribute('href') ? 'link' : '';
    case 'input': {
      const t = (el as HTMLInputElement).type;
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      return 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'option':
      return 'option';
    default:
      return '';
  }
}

/** A radix/uuid/hash-style id chunk that won't survive a re-render. */
function isDynamicId(id: string): boolean {
  const v = id.toLowerCase();
  if (v.startsWith('radix')) return true;
  if (/^:r[a-z0-9]+:?$/.test(v)) return true; // React useId ":r0:"
  if (/_r_[a-z0-9]+_/.test(v)) return true; // radix "_r_7_"
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) return true; // uuid
  if (/^[0-9a-f]{12,}$/.test(v)) return true; // long hex/hash
  return false;
}

/** Drop a leading dynamic-id chunk so the structural tail can still match (best-effort). */
export function templateSelector(selector: string | undefined): string | null {
  if (!selector) return null;
  const sel = selector.trim();
  if (!sel) return null;
  // "#dynamic > rest" → "rest", but only if the tail is specific enough (has an id/attr/class
  // anchor). A bare "div:nth-of-type(3)" matches huge unrelated containers — skip it.
  const m = sel.match(/^#([^\s>]+)\s*>\s*(.+)$/);
  if (m && isDynamicId(m[1])) return /[#[.]/.test(m[2]) ? m[2] : null;
  if (sel.startsWith('#') && !sel.includes('>') && isDynamicId(sel.slice(1))) return null;
  return sel;
}

function qsa(root: ParentNode, sel: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(sel));
  } catch {
    return [];
  }
}

/** Elements whose accessible name or text equals/contains the label (visible only). */
function byLabel(label: string): HTMLElement[] {
  if (label.length < 2) return [];
  const out: HTMLElement[] = [];
  for (const el of qsa(document, '*')) {
    if (!visible(el)) continue;
    const n = liveName(el);
    if (n === label || n.includes(label) || norm(el.textContent) === label) out.push(el);
  }
  return out;
}

/** True when some ancestor (a row/container) carries the anchor text. */
function insideAnchor(el: HTMLElement, anchorText: string): boolean {
  let node: HTMLElement | null = el.parentElement;
  for (let i = 0; node && i < 8; i++, node = node.parentElement) {
    if (norm(node.textContent).includes(anchorText)) return true;
  }
  return false;
}

/** 0..1 similarity of the element's viewport-relative centre to the recorded one. */
function positionScore(el: HTMLElement, rect: NonNullable<LocatorTarget['capturedRect']>, vp: { w: number; h: number }): number {
  if (!vp?.w || !vp?.h) return 0;
  const r = el.getBoundingClientRect();
  const cx = (r.left + r.width / 2) / window.innerWidth;
  const cy = (r.top + r.height / 2) / window.innerHeight;
  const wx = (rect.x + rect.w / 2) / vp.w;
  const wy = (rect.y + rect.h / 2) / vp.h;
  const d = Math.hypot(cx - wx, cy - wy); // 0 (same) .. ~1.4 (opposite corner)
  return Math.max(0, 1 - d);
}

export function resolveTarget(target?: LocatorTarget): ResolveResult {
  const empty: ResolveResult = { best: null, ranked: [], score: 0 };
  if (!target) return empty;

  const name = norm(target.name);
  const text = norm(target.text);
  const label = (name || text).slice(0, 80);
  const top = target.hierarchy?.[0];
  const wantRole = (top?.role ?? '').toLowerCase();
  const wantTestid = top?.testid;
  const anchorText = norm(target.anchor?.text);

  // --- Candidate pool (visible) ---
  const pool = new Set<HTMLElement>();
  const add = (els: HTMLElement[]) => els.forEach((e) => visible(e) && pool.add(e));
  if (wantTestid) add(qsa(document, `[data-testid="${CSS.escape(wantTestid)}"]`));
  if (target.selector) {
    add(qsa(document, target.selector));
    const t = templateSelector(target.selector);
    if (t && t !== target.selector) add(qsa(document, t));
  }
  if (label.length >= 2) add(byLabel(label));
  if (pool.size === 0) return empty;

  // --- Score ---
  const scored = [...pool].map((el) => {
    let s = 0;
    if (wantTestid && el.getAttribute('data-testid') === wantTestid) s += 5;
    if (anchorText && insideAnchor(el, anchorText)) s += 4;
    if (wantRole && roleOf(el) === wantRole) s += 3;
    const ln = liveName(el);
    if (name && ln === name) s += 3;
    else if (label && ln.includes(label)) s += 1;
    if (text && norm(el.textContent) === text) s += 2;
    if (actionable(el)) s += 1;
    if (target.capturedRect && target.capturedViewport) s += positionScore(el, target.capturedRect, target.capturedViewport);
    return { el, s };
  });

  // Prefer the tightest control: drop a candidate that CONTAINS another scoring at least as high.
  const kept = scored.filter(
    (a) => !scored.some((b) => b.el !== a.el && a.el.contains(b.el) && b.s >= a.s),
  );

  const area = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };
  kept.sort((a, b) => b.s - a.s || area(a.el) - area(b.el)); // higher score; tie → smaller box

  // Only keep top-tier matches (within 2 pts of the best). This drops weak coincidental
  // matches — e.g. a generic structural selector hitting a large container — so the pick
  // highlight outlines the real choice(s), not noise. Genuine list alternatives score alike.
  const topScore = kept[0]?.s ?? 0;
  const ranked = kept.filter((x) => x.s > 0 && x.s >= topScore - 2).map((x) => x.el);
  return { best: ranked[0] ?? null, ranked, score: topScore };
}
