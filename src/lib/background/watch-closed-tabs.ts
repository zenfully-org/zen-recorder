/**
 * Hands the browser's word that a tab was closed (`tabs.onRemoved`, which needs no permission) to
 * the recording manager, which ends the recording a closed tab lost the end of. A test build can
 * make a tab's close look like a crash: a crashed tab is not removed, and the e2e run cannot crash
 * a tab.
 */

interface TabRemovals {
  addListener(listener: (tabId: number) => void): void;
}

export interface ClosedTabs {
  /** The close of tab `tabId` is not reported, as if it had crashed (test builds only). */
  lookLikeACrash(
    tabId: number | undefined,
  ): Promise<{ closesLookLikeACrash: number } | { error: string }>;
}

export function watchClosedTabs(
  onRemoved: TabRemovals,
  tabClosed: (tabId: number) => void,
): ClosedTabs {
  const crashes = new Set<number>();
  onRemoved.addListener((tabId) => {
    if (!crashes.delete(tabId)) tabClosed(tabId);
  });
  return {
    async lookLikeACrash(tabId) {
      if (tabId === undefined) return { error: 'only a meeting tab can ask to look like a crash' };
      crashes.add(tabId);
      return { closesLookLikeACrash: tabId };
    },
  };
}
