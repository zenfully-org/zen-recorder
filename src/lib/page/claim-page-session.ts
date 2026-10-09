/**
 * The MAIN-world recorder cannot be unloaded: when the extension is reloaded, Firefox injects the
 * hook script again into open meeting tabs while the previous session keeps running. A second
 * session would hook WebRTC twice, record twice and overwrite the first one's snapshots (so the
 * running recording looks orphaned and gets finalized early). This keeps exactly one session per
 * page.
 *
 * The scripts share nothing but the page's window, which the page's own scripts read too: a
 * session kept on it under a name is a session the page can find, stop or tear down. So the
 * session is kept by its closure only, and the page is claimed by an event: a script dispatches a
 * cancelable claim, and the session that owns the page cancels it, before any listener of the
 * page sees it.
 */
import { getAddOnId } from '@/lib/get-add-on-id';

/** What the claim needs of a window; the real one and an `EventTarget` with `Event` both have it. */
export interface ClaimWindow {
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options: { capture: true },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: Event) => void,
    options: { capture: true },
  ): void;
  dispatchEvent(event: Event): boolean;
  Event: typeof Event;
}

/** Where sessions of earlier builds kept themselves; read only, so they still keep their page. */
const EARLIER_BUILDS_KEY = Symbol.for('zen-recorder.page-session');

const CLAIM = `${getAddOnId()}:claim-page`;
const CAPTURE = { capture: true } as const;

/** Cancels every later claim, unseen by the listeners the page adds after the recorder's. */
function answerClaim(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Creates the page's session, or returns null when a session from an earlier load already owns
 * the page (whatever its version: it is left alone and keeps recording).
 */
export function claimPageSession<S>(win: ClaimWindow, create: () => S): S | null {
  if (Reflect.get(win, EARLIER_BUILDS_KEY)) return null;
  if (!win.dispatchEvent(new win.Event(CLAIM, { cancelable: true }))) return null;
  // Answers before the session is created: a script that runs meanwhile stands down too.
  win.addEventListener(CLAIM, answerClaim, CAPTURE);
  try {
    return create();
  } catch (error) {
    win.removeEventListener(CLAIM, answerClaim, CAPTURE);
    throw error;
  }
}
