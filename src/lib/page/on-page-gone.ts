/**
 * Calls `handOver` as the page goes away, in the last task it runs, from two places: the page's
 * own `pagehide` listener, capturing so it runs before the bridge's end whichever registered
 * first, and the bridge's `bridge:handover`, sent from the bridge's own `pagehide` listener. When a
 * closed tab's content process shuts down with it, Firefox interrupts the script running at that
 * moment, once (the hang monitor's interrupt for an impending shutdown, which spares only Firefox's
 * own code), and that can stop the first call short; the second runs after it. The bridge relays
 * only what it has not sent yet, so a second call that finds nothing new sends nothing.
 */
import type { SyncNotices } from '@/lib/page/create-sync-notices';
import type { PageProtocolMap } from '@/lib/types';

/** What it needs of a window; the real one and the test double both have it. */
interface PageGoneWindow {
  addEventListener(type: 'pagehide', listener: () => void, options: { capture: true }): void;
  removeEventListener(type: 'pagehide', listener: () => void, options: { capture: true }): void;
}

export function onPageGone(
  win: PageGoneWindow,
  notices: Pick<SyncNotices<PageProtocolMap>, 'onSync'>,
  handOver: () => void,
): () => void {
  win.addEventListener('pagehide', handOver, { capture: true });
  const stopAsking = notices.onSync('bridge:handover', handOver);
  return () => {
    win.removeEventListener('pagehide', handOver, { capture: true });
    stopAsking();
  };
}
