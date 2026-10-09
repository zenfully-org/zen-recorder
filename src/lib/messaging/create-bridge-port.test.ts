import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundToTab } from '@/lib/types';
import { createFakePort, type FakePort } from '@/test/fakes/create-fake-port';
import { createBridgePort } from './create-bridge-port';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

function setup() {
  const ports: FakePort[] = [];
  const received: BackgroundToTab[] = [];
  const port = createBridgePort({
    connect: (info) => {
      const next = createFakePort(info.name);
      ports.push(next);
      return next;
    },
    onMessage: (message) => received.push(message),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (id) => window.clearInterval(id),
    bridgeId: 'bridge-1',
    reconnectDelayMs: 50,
  });
  const logsOn = (fake: FakePort | undefined) =>
    (fake?.posted ?? []).filter(
      (message) => typeof message === 'object' && message !== null && 'receipt' in message,
    );
  return { port, ports, received, logsOn };
}

const line = { level: 'info', message: 'recording ended (command) after 3 chunks' } as const;

describe('createBridgePort', () => {
  it('numbers the log lines it sends, and passes every other message on as it is', () => {
    const { port, ports, logsOn } = setup();
    port.connect();
    expect(port.send({ type: 'log', log: line })).toBe(true);
    expect(port.send({ type: 'ping' })).toBe(true);
    expect(ports[0]?.posted).toEqual([
      { type: 'log', log: line, at: 1_000_000, receipt: { bridge: 'bridge-1', seq: 1 } },
      { type: 'ping' },
    ]);
    expect(logsOn(ports[0])).toHaveLength(1);
  });

  it('sends a line lost with a dropped Port again on the new one, until the background acks it', async () => {
    const { port, ports, received, logsOn } = setup();
    port.connect();
    port.send({ type: 'log', log: line });
    // The background dropped the Port: what was on its way is gone.
    ports[0]?.disconnectFromOtherSide();
    await vi.advanceTimersByTimeAsync(5000);
    expect(logsOn(ports[1])).toEqual([
      { type: 'log', log: line, at: 1_000_000, receipt: { bridge: 'bridge-1', seq: 1 } },
    ]);
    ports[1]?.receive({ type: 'logAck', seq: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(logsOn(ports[1])).toHaveLength(1);
    // The ack is the Port's business: the bridge never hears it.
    expect(received).toEqual([]);
    ports[1]?.receive({ type: 'command', command: 'stop' });
    expect(received).toEqual([{ type: 'command', command: 'stop' }]);
  });

  it('stops sending lines again once closed', async () => {
    const { port, ports, logsOn } = setup();
    port.connect();
    port.send({ type: 'log', log: line });
    port.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ports).toHaveLength(1);
    expect(logsOn(ports[0])).toHaveLength(1);
    expect(port.connected()).toBe(false);
  });
});
