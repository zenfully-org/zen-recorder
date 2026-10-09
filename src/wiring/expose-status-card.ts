/**
 * Test builds only: hands the status card's shadow root to the meeting page's scripts as
 * `window.__zenRecorderCard`. The root is closed, so that the page cannot read what the card shows;
 * the end-to-end run, which drives the fake meeting pages from the page's own world, reads and
 * clicks the card through this handle instead. The bridge calls it behind the test build's
 * constant, so a release build leaves it out. Covered by the e2e run.
 *
 * The bridge runs in the content script's world: `window.wrappedJSObject` is the page's own view
 * of the window, and a DOM node set there is the same node to the page.
 */
export function exposeStatusCard(win: Window, root: ShadowRoot): void {
  const pageWindow: unknown = Reflect.get(win, 'wrappedJSObject');
  if (typeof pageWindow !== 'object' || pageWindow === null) return;
  Reflect.defineProperty(pageWindow, '__zenRecorderCard', { value: root, configurable: true });
}
