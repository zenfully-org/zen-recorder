/**
 * Meet is a single-page app: the meeting code appears in `location.pathname` without a page load.
 * Notifies on pushState/replaceState (patched through a Proxy), popstate and hashchange.
 */
export function watchNavigation(win: Window, onChange: () => void): () => void {
  const history = win.history;
  const originals = { pushState: history.pushState, replaceState: history.replaceState };
  const notify = () => queueMicrotask(onChange);
  for (const method of ['pushState', 'replaceState'] as const) {
    history[method] = new Proxy(originals[method], {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        notify();
        return result;
      },
    });
  }
  win.addEventListener('popstate', notify);
  win.addEventListener('hashchange', notify);
  return () => {
    history.pushState = originals.pushState;
    history.replaceState = originals.replaceState;
    win.removeEventListener('popstate', notify);
    win.removeEventListener('hashchange', notify);
  };
}
