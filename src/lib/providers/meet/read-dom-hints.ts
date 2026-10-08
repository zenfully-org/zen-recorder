/**
 * DOM corroboration signals for Google Meet. Class names are obfuscated and rotate, but the
 * Material Symbols ligature text inside `<i class="google-symbols">` is stable. Hints only;
 * WebRTC state is the primary signal.
 */

const SYMBOL_SELECTOR = '.google-symbols, .material-icons, .material-symbols-outlined';

/** Meet renders a tile (with its own id and a media slot) for every participant once admitted. */
const TILE_SELECTOR = '[data-participant-id][data-tile-media-id]';

export interface DomHints {
  /** The leave-call button is visible: user is in the meeting UI (could still be the lobby). */
  inCallUi: boolean;
  /**
   * The user has actually been admitted: the call UI is showing and at least one participant tile
   * exists. The "Still trying to get in…" lobby shows leave/chat controls but never tiles.
   */
  admitted: boolean;
}

export function readDomHints(root: ParentNode): DomHints {
  const symbols = new Set<string>();
  for (const el of root.querySelectorAll(SYMBOL_SELECTOR)) {
    const text = el.textContent?.trim();
    if (text) symbols.add(text);
  }
  const inCallUi = symbols.has('call_end');
  const admitted = inCallUi && root.querySelector(TILE_SELECTOR) !== null;
  return { inCallUi, admitted };
}
