import { getAddOnId } from '@/lib/get-add-on-id';
import { createSyncNotices, type SyncNotices } from '@/lib/page/create-sync-notices';
import { createWindowMessenger, type WindowMessenger } from '@/lib/page/create-window-messenger';
import type { PageProtocolMap } from '@/lib/types';

/** Messages that wait for their task, and notices that arrive in the sender's own task. */
export type PageMessenger = WindowMessenger<PageProtocolMap> & SyncNotices<PageProtocolMap>;

/**
 * The typed page ↔ bridge messenger, namespaced by the add-on id so the meeting page's own
 * postMessage traffic and events are ignored.
 */
export function createPageMessenger(win: Window & typeof globalThis): PageMessenger {
  const namespace = getAddOnId();
  return {
    ...createWindowMessenger<PageProtocolMap>(namespace, win),
    ...createSyncNotices<PageProtocolMap>(namespace, win),
  };
}
