const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

/**
 * Keeps the keys pressed on the status card from the meeting page's shortcuts (Space is
 * push-to-talk on some services). The card stops them where they leave it, but a page can listen
 * before that, in the capture phase on its window or its document, where a key pressed inside the
 * card's shadow root is aimed at the card's host element (`hostName`).
 *
 * This listener goes on the window in the capture phase, and runs before the page's own when it
 * is added before any script of the page runs (a `document_start` content script). It stops every
 * key event aimed at the card there and closes the card on Escape. Stopping an event keeps its
 * default action: Enter and Space still press the card's focused button, and Tab still moves the
 * focus. Returns the function that removes it.
 */
export function guardOverlayKeys(
  win: EventTarget,
  hostName: string,
  onEscape: () => void,
): () => void {
  const guard = (event: Event): void => {
    if (!(event.target instanceof Element) || event.target.localName !== hostName) return;
    event.stopImmediatePropagation();
    if (event instanceof KeyboardEvent && event.type === 'keydown' && event.key === 'Escape') {
      onEscape();
    }
  };
  for (const type of KEY_EVENTS) win.addEventListener(type, guard, { capture: true });
  return () => {
    for (const type of KEY_EVENTS) win.removeEventListener(type, guard, { capture: true });
  };
}
