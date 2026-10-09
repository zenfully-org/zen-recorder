import {
  type BridgeChannel,
  type BridgeLinkWindow,
  createBridgeLink,
} from '@/lib/bridge/create-bridge-link';
import { createBridgeMessenger } from '@/lib/bridge/create-bridge-messenger';
import { getAddOnId } from '@/lib/get-add-on-id';
import type { MessengerTimers } from '@/lib/page/create-link-messenger';
import type { PageMessenger } from '@/lib/page/create-page-messenger';
import type { SyncNoticeWindow } from '@/lib/page/create-sync-notices';
import { createWindowLink, type LinkWindow } from '@/lib/page/create-window-link';
import { hasEarlierPageSession } from '@/lib/page/has-earlier-page-session';

export interface PageConnectionDeps {
  createChannel: () => BridgeChannel;
  /**
   * The page's own view of the window, where a page session of an earlier build kept itself: in
   * the content script, `window.wrappedJSObject`.
   */
  pageWindow: unknown;
}

export interface PageConnection {
  messenger: PageMessenger;
  /** Closes the port and stops hearing the page. */
  dispose(): void;
}

/**
 * The bridge's connection to the page's recorder: a private port for a recorder of this build
 * (`createBridgeLink`), and the window, shut while the port is paired, for one of an earlier build
 * (`createBridgeMessenger`). A recorder of an earlier build found at start gets no connect event:
 * it would not take it, and the page's own listeners would see it.
 */
export function connectToPage<T>(
  win: BridgeLinkWindow & LinkWindow & SyncNoticeWindow & MessengerTimers<T>,
  deps: PageConnectionDeps,
): PageConnection {
  const namespace = getAddOnId();
  const earlierPage = hasEarlierPageSession(deps.pageWindow);
  const port = createBridgeLink(win, namespace, deps.createChannel, { connect: !earlierPage });
  const messenger = createBridgeMessenger({
    namespace,
    port,
    window: { link: createWindowLink(win, () => !port.paired()), notices: win },
    timers: win,
    earlierPage,
  });
  return {
    messenger,
    dispose() {
      messenger.dispose();
      port.dispose();
    },
  };
}
