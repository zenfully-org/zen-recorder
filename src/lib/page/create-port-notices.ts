import type { SyncNoticeWindow } from '@/lib/page/create-sync-notices';
import type { MessagePortLike } from '@/lib/protocol/parse-message-port';

/**
 * The notice listeners of one end of the page ↔ bridge channel, as the target of its notices: it
 * dispatches on the port that end holds now, and nowhere while it holds none.
 */
export interface PortNotices extends SyncNoticeWindow {
  /** Puts every listener on a port the end takes. */
  attach(port: MessagePortLike): void;
  /** Takes every listener off a port the end lets go of. */
  detach(port: MessagePortLike): void;
}

/**
 * Keeps the listeners by event type, so that they move with the port: a listener added before a
 * port is paired, or before a new one replaces it, is on every port the end takes.
 */
export function createPortNotices(
  heldPort: () => MessagePortLike | null,
  CustomEventConstructor: typeof CustomEvent,
): PortNotices {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const forEach = (visit: (type: string, listener: (event: Event) => void) => void): void => {
    for (const [type, ofType] of listeners) {
      for (const listener of ofType) visit(type, listener);
    }
  };
  return {
    addEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
      heldPort()?.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
      heldPort()?.removeEventListener(type, listener);
    },
    dispatchEvent: (event) => heldPort()?.dispatchEvent(event) ?? true,
    CustomEvent: CustomEventConstructor,
    attach: (port) => forEach((type, listener) => port.addEventListener(type, listener)),
    detach: (port) => forEach((type, listener) => port.removeEventListener(type, listener)),
  };
}
