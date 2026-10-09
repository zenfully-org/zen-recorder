/**
 * Where page sessions of earlier builds kept themselves: under a registered symbol on the window,
 * which any script of the page could read. Builds since keep their session in its closure, and
 * only read this, so that such a session keeps its page and the bridge talks to it its way.
 */
const EARLIER_BUILDS_KEY = Symbol.for('zen-recorder.page-session');

/**
 * Whether a page session of an earlier build runs in this window. `pageWindow` is the page's own
 * view of the window: in a content script, `window.wrappedJSObject`, since its Xray view hides
 * what the page's scripts defined.
 */
export function hasEarlierPageSession(pageWindow: unknown): boolean {
  if (typeof pageWindow !== 'object' || pageWindow === null) return false;
  return Boolean(Reflect.get(pageWindow, EARLIER_BUILDS_KEY));
}
