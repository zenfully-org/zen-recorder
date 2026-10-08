/**
 * The MAIN-world recorder cannot be unloaded: when the extension is reloaded, Firefox injects the
 * hook script again into open meeting tabs while the previous session keeps running. A second
 * session would hook WebRTC twice, record twice and overwrite the first one's snapshots (so the
 * running recording looks orphaned and gets finalized early). This keeps exactly one session per
 * page.
 */
import type { PageSession } from '@/lib/page/create-page-session';

const KEY = Symbol.for('zen-recorder.page-session');

/**
 * Creates the page's session, or returns null when one from a previous extension load already owns
 * the page (whatever its version: it is left alone and keeps recording).
 */
export function claimPageSession(win: Window, create: () => PageSession): PageSession | null {
  if (Reflect.get(win, KEY)) return null;
  const session = create();
  Object.defineProperty(win, KEY, { value: session, configurable: true, enumerable: false });
  return session;
}
