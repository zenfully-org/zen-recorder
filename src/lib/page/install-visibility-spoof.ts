/**
 * Experimental: makes the page believe it is visible so Meet keeps updating its video tiles while
 * the tab is in the background. Overrides `document.hidden`/`visibilityState` and swallows
 * `visibilitychange` before page listeners see it. Returns the uninstall function.
 */

const PROPS = ['hidden', 'visibilityState'] as const;

export function installVisibilitySpoof(win: Window): () => void {
  const doc = win.document;
  const previous = PROPS.map((prop) => [prop, Object.getOwnPropertyDescriptor(doc, prop)] as const);
  Object.defineProperty(doc, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(doc, 'visibilityState', { get: () => 'visible', configurable: true });
  const swallow = (event: Event): void => event.stopImmediatePropagation();
  doc.addEventListener('visibilitychange', swallow, true);
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    doc.removeEventListener('visibilitychange', swallow, true);
    for (const [prop, descriptor] of previous) {
      if (descriptor) Object.defineProperty(doc, prop, descriptor);
      else Reflect.deleteProperty(doc, prop);
    }
  };
}
