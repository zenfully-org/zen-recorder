import { describe, expect, it, vi } from 'vitest';
import type { PageProtocolMap } from '@/lib/types';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { createSyncNotices } from './create-sync-notices';
import { onPageGone } from './on-page-gone';

describe('onPageGone', () => {
  it('hands over on pagehide, capturing so it runs before the bridge, and again when the bridge asks', () => {
    const win = createFakeWindow();
    const notices = createSyncNotices<PageProtocolMap>('zen-recorder', win);
    const listen = vi.spyOn(win, 'addEventListener');
    let handovers = 0;
    const stop = onPageGone(win, notices, () => handovers++);
    expect(listen).toHaveBeenCalledWith('pagehide', expect.any(Function), { capture: true });
    win.emit('pagehide');
    // From the bridge's own pagehide listener: Firefox may have stopped the first one short.
    notices.notifySync('bridge:handover', undefined);
    expect(handovers).toBe(2);
    stop();
    win.emit('pagehide');
    notices.notifySync('bridge:handover', undefined);
    expect(handovers).toBe(2);
  });
});
