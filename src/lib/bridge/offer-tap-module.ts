/**
 * Hands the page recorder the URL of the audio tap's worklet file, which a page whose CSP refuses
 * a blob module can still load (see `createAudioTap`). The URL names the extension's per-install
 * id (`moz-extension://<uuid>/…`), which stays the same across sites and sessions, and Firefox
 * keeps it from pages: the recorder's own frames read `<anonymous code>` in their stack traces.
 * So the URL travels only while no script of the page can listen: at document_start, while the
 * document holds its root element and nothing else, in a dispatched event, which reaches the
 * listeners before `dispatchEvent` returns. The bridge offers it at once (a recorder already
 * listening takes it, cancelling the event), else answers the recorder's first request in that
 * same moment, and never again: an extension reload injects the bridge into a page whose scripts
 * run already, and that page is offered nothing.
 */

/** What the offer needs of a window; the real one and the test double both have it. */
export interface TapModuleWindow {
  document: { readyState: DocumentReadyState; documentElement: Element | null };
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  CustomEvent: typeof CustomEvent;
}

export function offerTapModule(win: TapModuleWindow, namespace: string, url: string): void {
  // Nothing but the root element: no script of the page has run, so none of it listens.
  const untouched = () =>
    win.document.readyState === 'loading' && !win.document.documentElement?.firstElementChild;
  // Taken when the recorder cancelled it.
  const offer = () =>
    !win.dispatchEvent(
      new win.CustomEvent(`${namespace}:tap-module`, { detail: url, cancelable: true }),
    );
  if (!untouched() || offer()) return;
  const wanted = `${namespace}:tap-module-wanted`;
  // The first request only: the recorder asks once, before any script of the page runs.
  const onWanted = () => {
    win.removeEventListener(wanted, onWanted);
    if (untouched()) offer();
  };
  win.addEventListener(wanted, onWanted);
}
