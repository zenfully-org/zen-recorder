import { getAddOnId } from '@/lib/get-add-on-id';
import { createWindowMessenger, type WindowMessenger } from '@/lib/page/create-window-messenger';
import type { PageProtocolMap } from '@/lib/types';

/**
 * The typed page ↔ bridge messenger, namespaced by the add-on id so the meeting page's own
 * postMessage traffic is ignored.
 */
export function createPageMessenger(win: Window): WindowMessenger<PageProtocolMap> {
  return createWindowMessenger<PageProtocolMap>(getAddOnId(), win);
}
