import { describe, expect, it, vi } from 'vitest';
import { getAddOnId } from '@/lib/get-add-on-id';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { createWindowLink } from '@/lib/page/create-window-link';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import { createFakeMessageChannel } from '@/test/fakes/create-fake-message-channel';
import { createFakeWindow, type FakeWindow } from '@/test/fakes/create-fake-window';
import { createBridgeLink } from './create-bridge-link';
import { createBridgeMessenger } from './create-bridge-messenger';

const NS = getAddOnId();
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const config = parsePageConfig({ autoRecord: true });

/** The bridge's messenger as the bridge wires it: the port, and the window only when closed. */
function bridgeOn(win: FakeWindow, earlierPage = false) {
  const link = createBridgeLink(win, NS, createFakeMessageChannel, { connect: !earlierPage });
  const messenger = createBridgeMessenger({
    namespace: NS,
    port: link,
    window: { link: createWindowLink(win, () => !link.paired()), notices: win },
    timers: win,
    earlierPage,
  });
  return { link, messenger };
}

/** What a page session of an earlier build posts: a request on the window. */
function postOnWindow(win: FakeWindow, type: string, data: unknown, id = 'old:1') {
  win.deliver({ ns: NS, kind: 'req', id, type, data }, win);
}

describe('createBridgeMessenger', () => {
  it('talks to a page session of this build over the port, and posts nothing on the window', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win);
    const { messenger: bridge } = bridgeOn(win);
    const configured = vi.fn();
    page.onMessage('bridge:configure', ({ data }) => configured(data));
    bridge.onMessage('page:chunk', () => ({ ok: true }) as const);
    const handedOver = vi.fn();
    bridge.onSync('page:handover', ({ data }) => handedOver(data));
    const asked = vi.fn();
    page.onSync('bridge:handover', asked);
    bridge.notify('bridge:configure', config);
    await expect(
      page.sendMessage('page:chunk', {
        recordingId: 'r',
        seq: 0,
        blob: new Blob(),
        timestampMs: 0,
      }),
    ).resolves.toEqual({ ok: true });
    page.notifySync('page:handover', { recordings: [] });
    bridge.notifySync('bridge:handover', undefined);
    await tick();
    expect(configured).toHaveBeenCalledWith(config);
    expect(handedOver).toHaveBeenCalledWith({ recordings: [] });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(win.postedOrigins).toEqual([]);
  });

  it('answers nothing a page script posts on the window while a page session of this build is paired', async () => {
    const win = createFakeWindow();
    createPageMessenger(win);
    const { messenger: bridge } = bridgeOn(win);
    const snapshot = vi.fn();
    bridge.onMessage('page:snapshot', snapshot);
    const handedOver = vi.fn();
    bridge.onSync('page:handover', handedOver);
    postOnWindow(win, 'page:snapshot', { state: 'idle' });
    win.dispatchEvent(new CustomEvent(`${NS}:page:handover`, { detail: { recordings: [] } }));
    await tick();
    expect(snapshot).not.toHaveBeenCalled();
    expect(handedOver).not.toHaveBeenCalled();
    bridge.notify('bridge:configure', config);
    await tick();
    expect(win.postedOrigins).toEqual([]);
  });

  it("talks the window's way to a page session of an earlier build found at start", async () => {
    const win = createFakeWindow();
    const connects = vi.fn();
    win.addEventListener(`${NS}:connect`, connects);
    const { messenger: bridge } = bridgeOn(win, true);
    const snapshot = vi.fn();
    bridge.onMessage('page:snapshot', ({ data }) => snapshot(data));
    const handedOver = vi.fn();
    bridge.onSync('page:handover', ({ data }) => handedOver(data));
    bridge.notify('bridge:configure', config);
    postOnWindow(win, 'page:snapshot', { state: 'idle' });
    win.dispatchEvent(new CustomEvent(`${NS}:page:handover`, { detail: { recordings: [] } }));
    await tick();
    expect(connects).not.toHaveBeenCalled();
    expect(win.postedOrigins.length).toBeGreaterThan(0);
    expect(snapshot).toHaveBeenCalledWith({ state: 'idle' });
    expect(handedOver).toHaveBeenCalledWith({ recordings: [] });
  });

  it('turns to the window when a page session of an earlier build speaks there, and configures it once', async () => {
    const win = createFakeWindow();
    const { messenger: bridge } = bridgeOn(win);
    const ready = vi.fn();
    bridge.onMessage('page:ready', ready);
    const snapshot = vi.fn();
    bridge.onMessage('page:snapshot', snapshot);
    // A recording page of an earlier build sends its snapshots, chunks and logs on the window.
    postOnWindow(win, 'page:snapshot', { state: 'recording' }, 'old:1');
    postOnWindow(win, 'page:snapshot', { state: 'recording' }, 'old:2');
    await tick();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(2);
    bridge.notify('bridge:configure', config);
    await tick();
    expect(win.postedOrigins.length).toBeGreaterThan(0);
  });

  it('configures an earlier page once when its first word on the window is that it is ready', async () => {
    const win = createFakeWindow();
    const { messenger: bridge } = bridgeOn(win);
    const ready = vi.fn();
    const stopReady = bridge.onMessage('page:ready', ready);
    postOnWindow(win, 'page:ready', undefined);
    await tick();
    expect(ready).toHaveBeenCalledTimes(1);
    stopReady();
  });

  it('stops hearing either way once disposed', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win);
    const { messenger: bridge } = bridgeOn(win);
    const chunk = vi.fn();
    const stopChunk = bridge.onMessage('page:chunk', chunk);
    const handedOver = vi.fn();
    const stopHandover = bridge.onSync('page:handover', handedOver);
    stopChunk();
    stopHandover();
    bridge.dispose();
    page.notify('page:chunk', { recordingId: 'r', seq: 0, blob: new Blob(), timestampMs: 0 });
    page.notifySync('page:handover', { recordings: [] });
    postOnWindow(win, 'page:chunk', {});
    await tick();
    expect(chunk).not.toHaveBeenCalled();
    expect(handedOver).not.toHaveBeenCalled();
    expect(win.listeners.get('message')?.size ?? 0).toBe(0);
  });
});
