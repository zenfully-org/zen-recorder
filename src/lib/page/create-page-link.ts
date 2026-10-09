/**
 * The recorder's end of its private channel to the bridge. The recorder runs in the meeting page's
 * own world, and the window is all it shares with the bridge, so whatever the two posted there,
 * every script of the page could read: the chunks, the snapshots, the settings. Instead the bridge
 * hands the recorder a `MessagePort` in a cancelable `<namespace>:connect` event on the window, and
 * everything else goes over that port. The notices that must arrive in the sender's own task (the
 * handover while the page goes away) are events dispatched on that same port, which both sides
 * hold.
 *
 * The recorder listens for the connect event from `document_start`, before any script of the page,
 * capturing on the window, so its listener runs first and stops the event there: the page's own
 * listeners never see it, on the first load or after an extension reload. When the recorder runs
 * before the bridge, it announces itself once with `<namespace>:recorder-ready`, while no script
 * of the page runs yet, and the bridge connects then.
 *
 * A page script that knows the event's name can dispatch a connect too. While the recorder has a
 * bridge, it keeps it: it holds the newcomer's port, unstarted, and pings its bridge; a bridge that
 * answers keeps the page, and the newcomer's port is closed. A bridge that stays silent is gone (an
 * extension reload ends its content script, which then answers nothing): after
 * `LIVENESS_CHECK_MS` the recorder takes the new port, and what the new bridge already posted
 * waits in it until then.
 */
import { z } from 'zod';
import type { MessageLink } from '@/lib/page/create-link-messenger';
import { createPortNotices } from '@/lib/page/create-port-notices';
import type { SyncNoticeWindow } from '@/lib/page/create-sync-notices';
import { type MessagePortLike, parseMessagePort } from '@/lib/protocol/parse-message-port';

/** How long the bridge the recorder has may take to answer before a new one replaces it. */
export const LIVENESS_CHECK_MS = 2_000;

/** What the link needs of a window; the real one and the test double both have it. */
export interface PageLinkWindow<T> {
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
  setTimeout(handler: () => void, ms: number): T;
  clearTimeout(id: T): void;
}

export interface PageLink {
  /** Messages to and from the bridge; what is posted while no bridge is paired is dropped. */
  link: MessageLink;
  /** The paired port, as the target of the notices that arrive in the sender's task. */
  notices: SyncNoticeWindow;
  dispose(): void;
}

const pongSchema = z.object({ kind: z.literal('pong') });
const isPong = (data: unknown): boolean => pongSchema.safeParse(data).success;
const CAPTURE = { capture: true } as const;

export function createPageLink<T>(win: PageLinkWindow<T>, namespace: string): PageLink {
  const connectEvent = `${namespace}:connect`;
  const messageListeners = new Set<(data: unknown) => void>();
  let current: MessagePortLike | null = null;
  const notices = createPortNotices(() => current, win.CustomEvent);
  /** Ends the check under way, without a decision; null while none runs. */
  let cancelCheck: (() => void) | null = null;

  const onPortMessage = (event: Event): void => {
    const data: unknown = Reflect.get(event, 'data');
    if (isPong(data)) return;
    for (const listener of messageListeners) listener(data);
  };

  const release = (port: MessagePortLike): void => {
    port.removeEventListener('message', onPortMessage);
    notices.detach(port);
    port.close();
  };

  const adopt = (port: MessagePortLike): void => {
    if (current) release(current);
    current = port;
    port.addEventListener('message', onPortMessage);
    notices.attach(port);
    port.start();
  };

  /** Asks the bridge on `paired` whether it is still there; takes `candidate` if it is not. */
  const checkBridge = (paired: MessagePortLike, candidate: MessagePortLike): void => {
    const end = (): void => {
      win.clearTimeout(timer);
      paired.removeEventListener('message', onPong);
      cancelCheck = null;
    };
    const onPong = (event: Event): void => {
      if (!isPong(Reflect.get(event, 'data'))) return;
      // The bridge answered: it keeps the page, and the newcomer gets nothing.
      end();
      candidate.close();
    };
    const timer = win.setTimeout(() => {
      end();
      adopt(candidate);
    }, LIVENESS_CHECK_MS);
    paired.addEventListener('message', onPong);
    cancelCheck = () => {
      end();
      candidate.close();
    };
    paired.postMessage({ ns: namespace, kind: 'ping' });
  };

  const onConnect = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const port = parseMessagePort(Reflect.get(event, 'detail'));
    if (!port) return;
    if (!current) adopt(port);
    else if (cancelCheck) port.close();
    else checkBridge(current, port);
  };

  win.addEventListener(connectEvent, onConnect, CAPTURE);
  win.dispatchEvent(new win.CustomEvent(`${namespace}:recorder-ready`));

  return {
    link: {
      post(envelope) {
        current?.postMessage(envelope);
      },
      listen(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
    },
    notices,
    dispose() {
      win.removeEventListener(connectEvent, onConnect, CAPTURE);
      cancelCheck?.();
      if (current) release(current);
      current = null;
    },
  };
}
