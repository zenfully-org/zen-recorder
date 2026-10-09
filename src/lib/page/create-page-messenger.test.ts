import { describe, expect, it } from 'vitest';
import { getAddOnId } from '@/lib/get-add-on-id';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { createPageMessenger } from './create-page-messenger';

describe('createPageMessenger', () => {
  it('connects two sides on the same window under the extension namespace', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win as unknown as Window & typeof globalThis);
    const bridge = createPageMessenger(win as unknown as Window & typeof globalThis);
    bridge.onMessage('page:chunk', () => ({ ok: true }) as const);
    await expect(
      page.sendMessage('page:chunk', {
        recordingId: 'r',
        seq: 0,
        blob: new Blob(),
        timestampMs: 0,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('answers traffic under the add-on id only', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win as unknown as Window & typeof globalThis);
    let calls = 0;
    page.onMessage('bridge:command', () => {
      calls++;
    });
    win.deliver(
      { ns: 'someone-else', kind: 'req', id: 'a:1', type: 'bridge:command', data: {} },
      win,
    );
    await new Promise((r) => setTimeout(r, 2));
    expect(calls).toBe(0);

    win.deliver(
      { ns: getAddOnId(), kind: 'req', id: 'a:2', type: 'bridge:command', data: {} },
      win,
    );
    await new Promise((r) => setTimeout(r, 2));
    expect(calls).toBe(1);
  });
});
