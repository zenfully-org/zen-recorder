import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageLink, LIVENESS_CHECK_MS } from '@/lib/page/create-page-link';
import { createFakeMessageChannel, type FakePort } from '@/test/fakes/create-fake-message-channel';
import { createFakeWindow, type FakeWindow } from '@/test/fakes/create-fake-window';
import { createBridgeLink } from './create-bridge-link';

const NS = 'ns';

/** A channel factory that remembers every channel it made. */
function channels() {
  const made: { port1: FakePort; port2: FakePort }[] = [];
  return {
    made,
    create: () => {
      const channel = createFakeMessageChannel();
      made.push(channel);
      return channel;
    },
  };
}

function heardBy(link: { listen(listener: (data: unknown) => void): () => void }): unknown[] {
  const heard: unknown[] = [];
  link.listen((data) => heard.push(data));
  return heard;
}

describe('createBridgeLink', () => {
  let win: FakeWindow;
  beforeEach(() => {
    vi.useFakeTimers();
    win = createFakeWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects at once to a recorder that is there, and talks over the port both ways', async () => {
    const page = createPageLink(win, NS);
    const bridge = createBridgeLink(win, NS, channels().create);
    expect(bridge.paired()).toBe(true);
    const heardByPage = heardBy(page.link);
    const heardByBridge = heardBy(bridge.link);
    bridge.link.post({ configure: true });
    page.link.post({ ready: true });
    await vi.runAllTimersAsync();
    expect(heardByPage).toEqual([{ configure: true }]);
    expect(heardByBridge).toEqual([{ ready: true }]);
  });

  it('waits for a recorder that starts after it, then connects, unseen by the page', async () => {
    const factory = channels();
    const bridge = createBridgeLink(win, NS, factory.create);
    expect(bridge.paired()).toBe(false);
    expect(factory.made[0]?.port1.isClosed()).toBe(true);
    const heardByBridge = heardBy(bridge.link);
    const page = createPageLink(win, NS);
    expect(bridge.paired()).toBe(true);
    page.link.post({ ready: true });
    await vi.runAllTimersAsync();
    expect(heardByBridge).toEqual([{ ready: true }]);
  });

  it('drops what it posts until a recorder takes its port', () => {
    const bridge = createBridgeLink(win, NS, channels().create);
    expect(() => bridge.link.post({ configure: true })).not.toThrow();
  });

  it("answers the recorder's checks, so a page script that connects later cannot take its place", async () => {
    const page = createPageLink(win, NS);
    const bridge = createBridgeLink(win, NS, channels().create);
    const heardByBridge = heardBy(bridge.link);
    const intruder = createFakeMessageChannel();
    win.dispatchEvent(
      new CustomEvent(`${NS}:connect`, { detail: intruder.port2, cancelable: true }),
    );
    await vi.advanceTimersByTimeAsync(LIVENESS_CHECK_MS * 2);
    page.link.post({ chunk: 1 });
    await vi.runAllTimersAsync();
    expect(intruder.port2.isClosed()).toBe(true);
    expect(heardByBridge).toEqual([{ chunk: 1 }]);
  });

  it("delivers notices to the recorder's listeners and hears the recorder's, in the sender's task", () => {
    const bridge = createBridgeLink(win, NS, channels().create);
    const toBridge: unknown[] = [];
    // Registered before the recorder starts, as the bridge does at document_start.
    bridge.notices.addEventListener(`${NS}:page:handover`, (event) =>
      toBridge.push(Reflect.get(event, 'detail')),
    );
    expect(bridge.notices.dispatchEvent(new CustomEvent(`${NS}:bridge:handover`))).toBe(true);
    const page = createPageLink(win, NS);
    const toPage: unknown[] = [];
    page.notices.addEventListener(`${NS}:bridge:handover`, () => toPage.push('handover'));
    bridge.notices.dispatchEvent(new bridge.notices.CustomEvent(`${NS}:bridge:handover`));
    page.notices.dispatchEvent(new CustomEvent(`${NS}:page:handover`, { detail: { held: 1 } }));
    expect(toPage).toEqual(['handover']);
    expect(toBridge).toEqual([{ held: 1 }]);
    const unheard = vi.fn();
    bridge.notices.addEventListener(`${NS}:page:other`, unheard);
    bridge.notices.removeEventListener(`${NS}:page:other`, unheard);
    page.notices.dispatchEvent(new CustomEvent(`${NS}:page:other`));
    expect(unheard).not.toHaveBeenCalled();
  });

  it('does not connect when told a page session of an earlier build owns the page', () => {
    const seen = vi.fn();
    win.addEventListener(`${NS}:connect`, seen);
    const factory = channels();
    const bridge = createBridgeLink(win, NS, factory.create, { connect: false });
    createPageLink(win, NS);
    expect(seen).not.toHaveBeenCalled();
    expect(factory.made).toEqual([]);
    expect(bridge.paired()).toBe(false);
  });

  it('closes its port and stops waiting once disposed', () => {
    const factory = channels();
    const waiting = createBridgeLink(win, NS, factory.create);
    waiting.dispose();
    createPageLink(win, NS);
    expect(waiting.paired()).toBe(false);
    const bridge = createBridgeLink(win, NS, factory.create);
    bridge.dispose();
    expect(factory.made.at(-1)?.port1.isClosed()).toBe(true);
    expect(bridge.paired()).toBe(false);
  });
});
