import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createFakeMessageChannel,
  type FakeMessageChannel,
  type FakePort,
} from '@/test/fakes/create-fake-message-channel';
import { createFakeWindow, type FakeWindow } from '@/test/fakes/create-fake-window';
import { createPageLink, LIVENESS_CHECK_MS } from './create-page-link';

const NS = 'ns';
const CONNECT = `${NS}:connect`;

const pingSchema = z.object({ ns: z.literal(NS), kind: z.literal('ping') });

/** What a bridge does to pair: hands the page one port of a channel of its own. */
function connect(win: FakeWindow): FakeMessageChannel & { accepted: boolean } {
  const channel = createFakeMessageChannel();
  const accepted = !win.dispatchEvent(
    new CustomEvent(CONNECT, { detail: channel.port2, cancelable: true }),
  );
  return { ...channel, accepted };
}

/** The messages that reach a port, as a live bridge hears them; it answers every ping. */
function hear(port: FakePort, answerPings = true): unknown[] {
  const heard: unknown[] = [];
  port.addEventListener('message', (event) => {
    const data: unknown = Reflect.get(event, 'data');
    if (!pingSchema.safeParse(data).success) heard.push(data);
    else if (answerPings) port.postMessage({ ns: NS, kind: 'pong' });
  });
  port.start();
  return heard;
}

describe('createPageLink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pairs with the bridge that connects, and talks over its port both ways', async () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    const heardByPage: unknown[] = [];
    page.link.listen((data) => heardByPage.push(data));
    const bridge = connect(win);
    expect(bridge.accepted).toBe(true);
    const heardByBridge = hear(bridge.port1);
    page.link.post({ n: 1 });
    bridge.port1.postMessage({ n: 2 });
    await vi.runAllTimersAsync();
    expect(heardByBridge).toEqual([{ n: 1 }]);
    expect(heardByPage).toEqual([{ n: 2 }]);
  });

  it("announces itself once, and keeps every handshake from the page's own listeners", () => {
    const win = createFakeWindow();
    const announced = vi.fn();
    win.addEventListener(`${NS}:recorder-ready`, announced);
    createPageLink(win, NS);
    expect(announced).toHaveBeenCalledTimes(1);
    // The page's scripts run after the recorder, so their listeners come later.
    const seen: string[] = [];
    win.addEventListener(CONNECT, () => seen.push('bubble'));
    win.addEventListener(CONNECT, () => seen.push('capture'), { capture: true });
    expect(connect(win).accepted).toBe(true);
    expect(seen).toEqual([]);
  });

  it('drops what it posts while no bridge is paired, as a window nobody listens on does', async () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    expect(() => page.link.post({ early: true })).not.toThrow();
    const bridge = connect(win);
    const heardByBridge = hear(bridge.port1);
    await vi.runAllTimersAsync();
    expect(heardByBridge).toEqual([]);
  });

  it("delivers a notice to the other side's listeners before the dispatch returns, both ways", () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    const toPage: unknown[] = [];
    // Registered before any bridge pairs, as the page session does at document_start.
    page.notices.addEventListener(`${NS}:bridge:handover`, (event) =>
      toPage.push(Reflect.get(event, 'detail')),
    );
    expect(page.notices.dispatchEvent(new CustomEvent(`${NS}:page:handover`))).toBe(true);
    const bridge = connect(win);
    const toBridge: unknown[] = [];
    bridge.port2.addEventListener(`${NS}:page:handover`, (event) =>
      toBridge.push(Reflect.get(event, 'detail')),
    );
    page.notices.dispatchEvent(
      new page.notices.CustomEvent(`${NS}:page:handover`, { detail: { held: 1 } }),
    );
    bridge.port2.dispatchEvent(new CustomEvent(`${NS}:bridge:handover`, { detail: 'again' }));
    expect(toBridge).toEqual([{ held: 1 }]);
    expect(toPage).toEqual(['again']);
  });

  it('keeps the bridge that still answers: a page script that connects later gets a closed port, and nothing goes either way', async () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    const heardByPage: unknown[] = [];
    page.link.listen((data) => heardByPage.push(data));
    const bridge = connect(win);
    const heardByBridge = hear(bridge.port1);
    const intruder = connect(win);
    expect(intruder.accepted).toBe(true);
    const heardByIntruder = hear(intruder.port1);
    intruder.port1.postMessage({ ns: NS, kind: 'req', id: 'x:1', type: 'bridge:command' });
    // The bridge goes on talking while the recorder checks it.
    bridge.port1.postMessage({ snapshot: 'asked for' });
    await vi.advanceTimersByTimeAsync(LIVENESS_CHECK_MS * 2);
    page.link.post({ n: 1 });
    await vi.runAllTimersAsync();
    expect(intruder.port2.isClosed()).toBe(true);
    expect(heardByIntruder).toEqual([]);
    expect(heardByPage).toEqual([{ snapshot: 'asked for' }]);
    expect(heardByBridge).toEqual([{ n: 1 }]);
  });

  it('takes the new bridge when the one it has stays silent (an extension reload)', async () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    const heardByPage: unknown[] = [];
    page.link.listen((data) => heardByPage.push(data));
    const toPage: unknown[] = [];
    page.notices.addEventListener(`${NS}:bridge:handover`, () => toPage.push('handover'));
    const dead = connect(win);
    hear(dead.port1, false);
    const fresh = connect(win);
    const heardByFresh = hear(fresh.port1);
    // The new bridge configures the page at once; it waits in the port until the page takes it.
    fresh.port1.postMessage({ configure: true });
    await vi.advanceTimersByTimeAsync(LIVENESS_CHECK_MS - 1);
    expect(heardByPage).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    page.link.post({ n: 1 });
    fresh.port2.dispatchEvent(new CustomEvent(`${NS}:bridge:handover`));
    dead.port2.dispatchEvent(new CustomEvent(`${NS}:bridge:handover`));
    await vi.runAllTimersAsync();
    expect(dead.port2.isClosed()).toBe(true);
    expect(heardByPage).toEqual([{ configure: true }]);
    expect(heardByFresh).toEqual([{ n: 1 }]);
    expect(toPage).toEqual(['handover']);
  });

  it('closes a connect that comes while a check is under way, and still hides it', async () => {
    const win = createFakeWindow();
    createPageLink(win, NS);
    hear(connect(win).port1, false);
    const first = connect(win);
    const second = connect(win);
    expect(second.accepted).toBe(true);
    expect(second.port2.isClosed()).toBe(true);
    await vi.advanceTimersByTimeAsync(LIVENESS_CHECK_MS);
    expect(first.port2.isClosed()).toBe(false);
  });

  it('hides a connect that carries no port, and stays unpaired', () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    const event = new CustomEvent(CONNECT, { detail: { not: 'a port' }, cancelable: true });
    expect(win.dispatchEvent(event)).toBe(false);
    expect(page.notices.dispatchEvent(new CustomEvent(`${NS}:page:handover`))).toBe(true);
  });

  it('stops pairing once disposed, and closes its port and a port it was checking', () => {
    const win = createFakeWindow();
    const page = createPageLink(win, NS);
    const paired = connect(win);
    const checking = connect(win);
    page.dispose();
    expect(paired.port2.isClosed()).toBe(true);
    expect(checking.port2.isClosed()).toBe(true);
    expect(connect(win).accepted).toBe(false);
    page.dispose();
  });
});
