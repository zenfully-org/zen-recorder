import { getAddOnId } from '@/lib/get-add-on-id';
import { createLinkMessenger, type Messenger } from '@/lib/page/create-link-messenger';
import { createPageLink, type PageLinkWindow } from '@/lib/page/create-page-link';
import { createSyncNotices, type SyncNotices } from '@/lib/page/create-sync-notices';
import type { PageProtocolMap } from '@/lib/types';

/** Messages that wait for their task, and notices that arrive in the sender's own task. */
export type PageMessenger = Messenger<PageProtocolMap> & SyncNotices<PageProtocolMap>;

/**
 * The recorder's typed messenger to the bridge, over the private port the bridge hands it
 * (`createPageLink`): nothing of it goes through the window, where the page's own scripts would
 * read it. The add-on id names the events and the messages.
 */
export function createPageMessenger<T>(win: PageLinkWindow<T>): PageMessenger {
  const namespace = getAddOnId();
  const page = createPageLink(win, namespace);
  const messenger = createLinkMessenger<PageProtocolMap, T>(namespace, page.link, win);
  return {
    ...messenger,
    ...createSyncNotices<PageProtocolMap>(namespace, page.notices),
    dispose() {
      messenger.dispose();
      page.dispose();
    },
  };
}
