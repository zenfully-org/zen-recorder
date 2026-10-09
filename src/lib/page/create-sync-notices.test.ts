import { describe, expect, it } from 'vitest';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { createSyncNotices } from './create-sync-notices';

type Protocol = {
  'page:handover': (data: { recordings: string[] }) => void;
  'page:other': (data: number) => void;
};

describe('createSyncNotices', () => {
  it('delivers a notice to the other side inside the call, before it returns', () => {
    const win = createFakeWindow();
    const page = createSyncNotices<Protocol>('ns', win);
    const bridge = createSyncNotices<Protocol>('ns', win);
    const order: string[] = [];
    bridge.onSync('page:handover', ({ data }) => order.push(`got ${JSON.stringify(data)}`));
    page.notifySync('page:handover', { recordings: ['r1'] });
    order.push('returned');
    expect(order).toEqual(['got {"recordings":["r1"]}', 'returned']);
  });

  it('ignores other types, other namespaces and events without a detail, and stops listening', () => {
    const win = createFakeWindow();
    const bridge = createSyncNotices<Protocol>('ns', win);
    const got: unknown[] = [];
    const off = bridge.onSync('page:handover', ({ data }) => got.push(data));
    createSyncNotices<Protocol>('ns', win).notifySync('page:other', 1);
    createSyncNotices<Protocol>('another', win).notifySync('page:handover', {
      recordings: [],
    });
    win.emit('ns:page:handover', { type: 'ns:page:handover' });
    expect(got).toEqual([]);
    off();
    createSyncNotices<Protocol>('ns', win).notifySync('page:handover', {
      recordings: ['late'],
    });
    expect(got).toEqual([]);
  });
});
