/**
 * The bridge's end of its private channel to the recorder (see `createPageLink`, the other end).
 * The bridge makes a `MessageChannel` and hands the recorder its second port in a cancelable
 * `<namespace>:connect` event on the window; the recorder cancels it, so the bridge knows it took
 * the port. Messages go out on the first port, and the recorder's arrive there; the notices that
 * must arrive in the sender's task are events on the second port, which both sides hold. The
 * bridge answers the recorder's pings on its own, so that it keeps the page against a page script
 * that connects too.
 *
 * When no recorder takes the port, the recorder has not started yet (both scripts start at
 * `document_start`, in either order): the bridge waits for its `<namespace>:recorder-ready` and
 * connects then. A page whose recorder comes from an earlier build speaks only the window, and
 * there the connect event would reach the page's own listeners: told so, the bridge does not
 * connect at all.
 */
import { z } from 'zod';
import type { MessageLink } from '@/lib/page/create-link-messenger';
import { createPortNotices } from '@/lib/page/create-port-notices';
import type { SyncNoticeWindow } from '@/lib/page/create-sync-notices';
import type { MessagePortLike } from '@/lib/protocol/parse-message-port';

/** What the link needs of a window; the real one and the test double both have it. */
export interface BridgeLinkWindow {
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
  CustomEvent: typeof CustomEvent;
}

export interface BridgeChannel {
  port1: MessagePortLike;
  port2: MessagePortLike;
}

export interface BridgeLink {
  /** Messages to and from the recorder; what is posted before a recorder takes the port is dropped. */
  link: MessageLink;
  /** The recorder's port, as the target of the notices that arrive in the sender's task. */
  notices: SyncNoticeWindow;
  /** Whether a recorder took the port. */
  paired(): boolean;
  dispose(): void;
}

export interface BridgeLinkOptions {
  /** False when a page session of an earlier build owns the page: it speaks only the window. */
  connect?: boolean;
}

const pingSchema = z.object({ kind: z.literal('ping') });
const CAPTURE = { capture: true } as const;

export function createBridgeLink(
  win: BridgeLinkWindow,
  namespace: string,
  createChannel: () => BridgeChannel,
  options: BridgeLinkOptions = {},
): BridgeLink {
  const readyEvent = `${namespace}:recorder-ready`;
  const messageListeners = new Set<(data: unknown) => void>();
  let channel: BridgeChannel | null = null;
  const notices = createPortNotices(() => channel?.port2 ?? null, win.CustomEvent);

  const onPortMessage = (event: Event): void => {
    const data: unknown = Reflect.get(event, 'data');
    if (!pingSchema.safeParse(data).success) {
      for (const listener of messageListeners) listener(data);
      return;
    }
    // Only the recorder holds the other end of this port.
    channel?.port1.postMessage({ ns: namespace, kind: 'pong' });
  };

  const connect = (): void => {
    const next = createChannel();
    const taken = !win.dispatchEvent(
      new win.CustomEvent(`${namespace}:connect`, { detail: next.port2, cancelable: true }),
    );
    if (!taken) {
      next.port1.close();
      return;
    }
    channel = next;
    win.removeEventListener(readyEvent, onReady, CAPTURE);
    next.port1.addEventListener('message', onPortMessage);
    notices.attach(next.port2);
    next.port1.start();
  };

  function onReady(event: Event): void {
    event.stopImmediatePropagation();
    connect();
  }

  if (options.connect ?? true) {
    win.addEventListener(readyEvent, onReady, CAPTURE);
    connect();
  }

  return {
    link: {
      post(envelope) {
        channel?.port1.postMessage(envelope);
      },
      listen(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
    },
    notices,
    paired: () => channel !== null,
    dispose() {
      win.removeEventListener(readyEvent, onReady, CAPTURE);
      channel?.port1.close();
      channel = null;
    },
  };
}
