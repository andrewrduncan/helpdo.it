/**
 * Page-context capture — the Datadog-RUM-style piece. Today it grabs the
 * lightweight, always-available signals; later this is where DOM snapshots,
 * element selectors, and screenshots get added to ground answers and to give
 * admins what they need to author new ones.
 */
export interface PageContext {
  url: string;
  path: string;
  title: string;
  selectionText: string;
  viewport: { width: number; height: number };
  capturedAt: string;
}

export function capturePageContext(): PageContext {
  const selection = window.getSelection?.()?.toString() ?? '';
  return {
    url: location.href,
    path: location.pathname + location.search,
    title: document.title,
    selectionText: selection.slice(0, 500),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    capturedAt: new Date().toISOString(),
  };
}
