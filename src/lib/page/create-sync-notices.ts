/**
 * Notices between the MAIN-world recorder and the ISOLATED bridge that arrive in the same task, as
 * a DOM event on the window: every listener runs before `dispatchEvent` returns, the content
 * script's included. It is the one way left for a page that goes away. Inside `pagehide` the page
 * runs no later task, so a `window.postMessage` is never delivered (Gecko drops it once the window
 * is no longer the current, fully active one), while a dispatched event still reaches the bridge,
 * which can relay it on its Port there.
 *
 * The detail is the sender's own object. A content script reads it through Xray vision: plain
 * objects and arrays show their data properties, a `Blob` stays a `Blob`, functions are hidden.
 * The receiver validates it like any message from the other world.
 */
import type { ProtocolMapShape } from '@/lib/page/create-link-messenger';

type DataOf<P, K extends keyof P> = P[K] extends (data: infer D) => unknown ? D : never;

/** What the notices need of a window; the real one and the test double both have it. */
export interface SyncNoticeWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  CustomEvent: typeof CustomEvent;
}

export interface SyncNotices<P extends ProtocolMapShape> {
  /** Delivers `data` to the `onSync` listeners of `type` before it returns. */
  notifySync<K extends keyof P & string>(type: K, data: DataOf<P, K>): void;
  /** The listener receives the data untyped: it crossed the world boundary. */
  onSync<K extends keyof P & string>(
    type: K,
    handler: (message: { data: unknown }) => void,
  ): () => void;
}

export function createSyncNotices<P extends ProtocolMapShape>(
  namespace: string,
  win: SyncNoticeWindow,
): SyncNotices<P> {
  const eventType = (type: string) => `${namespace}:${type}`;
  return {
    notifySync(type, data) {
      win.dispatchEvent(new win.CustomEvent(eventType(type), { detail: data }));
    },
    onSync(type, handler) {
      const listener = (event: Event) => {
        if ('detail' in event) handler({ data: event.detail });
      };
      win.addEventListener(eventType(type), listener);
      return () => win.removeEventListener(eventType(type), listener);
    },
  };
}
