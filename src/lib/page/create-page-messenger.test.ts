import { describe, expect, it, vi } from 'vitest';
import { createBridgeLink } from '@/lib/bridge/create-bridge-link';
import { getAddOnId } from '@/lib/get-add-on-id';
import { createFakeMessageChannel } from '@/test/fakes/create-fake-message-channel';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { createLinkMessenger } from './create-link-messenger';
import { createPageMessenger } from './create-page-messenger';

const chunk = { recordingId: 'r', seq: 0, blob: new Blob(), timestampMs: 0 };

describe('createPageMessenger', () => {
  it('talks to the bridge over the port the bridge hands it, and posts nothing on the window', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win);
    const bridgeLink = createBridgeLink(win, getAddOnId(), createFakeMessageChannel);
    const bridge = createLinkMessenger(getAddOnId(), bridgeLink.link, win);
    bridge.onMessage('page:chunk', () => ({ ok: true }) as const);
    await expect(page.sendMessage('page:chunk', chunk)).resolves.toEqual({ ok: true });
    expect(win.postedOrigins).toEqual([]);
  });

  it('hears nothing a script of the page posts on the window, even in the right namespace', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win);
    const handler = vi.fn();
    page.onMessage('bridge:command', handler);
    win.deliver(
      { ns: getAddOnId(), kind: 'req', id: 'a:1', type: 'bridge:command', data: {} },
      win,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it('pairs with no bridge once disposed', () => {
    const win = createFakeWindow();
    createPageMessenger(win).dispose();
    expect(createBridgeLink(win, getAddOnId(), createFakeMessageChannel).paired()).toBe(false);
  });
});
