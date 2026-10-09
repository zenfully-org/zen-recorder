/**
 * The bridge's typed messenger to the page's recorder. A recorder of this build talks over the
 * private port of `createBridgeLink`, and nothing goes through the window. A recorder can be older
 * than the bridge, though: it keeps running across an extension update, and one of an earlier
 * build speaks only the window, where every script of the page reads along. The bridge talks to
 * such a page its way, and only then: when it found the earlier session at start
 * (`earlierPage`), or when an unpaired page sends it a request on the window, as a recording one
 * does with every chunk. Then it configures the page, so that it announces its recording again.
 *
 * The window link it is given stays shut while the port is paired: what a page script posts there
 * in the recorder's name is then neither heard nor answered.
 */
import {
  createLinkMessenger,
  type MessageLink,
  type MessengerTimers,
} from '@/lib/page/create-link-messenger';
import type { PageMessenger } from '@/lib/page/create-page-messenger';
import { createSyncNotices, type SyncNoticeWindow } from '@/lib/page/create-sync-notices';
import type { PageProtocolMap } from '@/lib/types';

/** One way to the page: its messages, and the target of its notices. */
interface PageRoute {
  link: MessageLink;
  notices: SyncNoticeWindow;
}

export interface BridgeMessengerDeps<T> {
  namespace: string;
  /** The private port to a recorder of this build. */
  port: PageRoute;
  /** The window, for a recorder of an earlier build. */
  window: PageRoute;
  timers: MessengerTimers<T>;
  /** A page session of an earlier build owns the page: it speaks only the window. */
  earlierPage: boolean;
}

export function createBridgeMessenger<T>(deps: BridgeMessengerDeps<T>): PageMessenger {
  const { namespace } = deps;
  let onWindow = deps.earlierPage;
  /** Each request handler, by type: the window's first request runs the `page:ready` one. */
  const handlers = new Map<string, (message: { data: unknown }) => unknown>();

  const turnToWindow = (type: string): void => {
    if (onWindow) return;
    onWindow = true;
    // The page's own `page:ready` configures it anyway.
    if (type !== 'page:ready') handlers.get('page:ready')?.({ data: undefined });
  };

  const viaPort: PageMessenger = {
    ...createLinkMessenger<PageProtocolMap, T>(namespace, deps.port.link, deps.timers),
    ...createSyncNotices<PageProtocolMap>(namespace, deps.port.notices),
  };
  const viaWindow: PageMessenger = {
    ...createLinkMessenger<PageProtocolMap, T>(namespace, deps.window.link, deps.timers, {
      onRequest: turnToWindow,
    }),
    ...createSyncNotices<PageProtocolMap>(namespace, deps.window.notices),
  };
  const active = (): PageMessenger => (onWindow ? viaWindow : viaPort);

  return {
    sendMessage: (type, data) => active().sendMessage(type, data),
    notify: (type, data) => active().notify(type, data),
    notifySync: (type, data) => active().notifySync(type, data),
    onMessage(type, handler) {
      handlers.set(type, handler);
      const stops = [viaPort.onMessage(type, handler), viaWindow.onMessage(type, handler)];
      return () => {
        for (const stop of stops) stop();
      };
    },
    onSync(type, handler) {
      const stops = [
        viaPort.onSync(type, handler),
        viaWindow.onSync(type, (message) => {
          if (onWindow) handler(message);
        }),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    dispose() {
      viaPort.dispose();
      viaWindow.dispose();
    },
  };
}
