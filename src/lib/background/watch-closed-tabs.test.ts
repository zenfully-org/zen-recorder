import { describe, expect, it, vi } from 'vitest';
import { watchClosedTabs } from './watch-closed-tabs';

/** `tabs.onRemoved`, with a way to remove a tab. */
function fakeOnRemoved() {
  const listeners: ((tabId: number) => void)[] = [];
  return {
    addListener: (listener: (tabId: number) => void) => listeners.push(listener),
    remove: (tabId: number) => {
      for (const listener of listeners) listener(tabId);
    },
  };
}

describe('watchClosedTabs', () => {
  it('tells the recording manager about every tab the browser closes', () => {
    const onRemoved = fakeOnRemoved();
    const tabClosed = vi.fn();
    watchClosedTabs(onRemoved, tabClosed);

    onRemoved.remove(4);
    onRemoved.remove(7);

    expect(tabClosed.mock.calls).toEqual([[4], [7]]);
  });

  it('keeps quiet about a tab a test build made look like a crash, which no removal reports', async () => {
    const onRemoved = fakeOnRemoved();
    const tabClosed = vi.fn();
    const closedTabs = watchClosedTabs(onRemoved, tabClosed);

    expect(await closedTabs.lookLikeACrash(4)).toEqual({ closesLookLikeACrash: 4 });
    onRemoved.remove(4);
    onRemoved.remove(5);

    expect(tabClosed.mock.calls).toEqual([[5]]);
  });

  it('refuses to make a crash of a caller that is no tab', async () => {
    const closedTabs = watchClosedTabs(fakeOnRemoved(), vi.fn());

    expect(await closedTabs.lookLikeACrash(undefined)).toEqual({
      error: 'only a meeting tab can ask to look like a crash',
    });
  });
});
