import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabToBackground } from '@/lib/types';
import { createLogOutbox } from './create-log-outbox';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

function setup(options: { max?: number } = {}) {
  const posted: TabToBackground[] = [];
  const port = { up: true };
  const outbox = createLogOutbox({
    send: (message) => {
      if (port.up) posted.push(message);
      return port.up;
    },
    bridgeId: 'bridge-1',
    now: () => Date.now(),
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (id) => window.clearInterval(id),
    ...options,
  });
  const lines = () => posted.flatMap((m) => (m.type === 'log' ? [m.log.message] : []));
  return { outbox, posted, port, lines };
}

describe('createLogOutbox', () => {
  it('sends each line at once, with the time it got it and a number of its own', () => {
    const { outbox, posted } = setup();
    outbox.send({ level: 'info', message: 'one' });
    vi.advanceTimersByTime(250);
    outbox.send({ level: 'warn', message: 'two' });
    expect(posted).toEqual([
      {
        type: 'log',
        log: { level: 'info', message: 'one' },
        at: 1_000_000,
        receipt: { bridge: 'bridge-1', seq: 1 },
      },
      {
        type: 'log',
        log: { level: 'warn', message: 'two' },
        at: 1_000_250,
        receipt: { bridge: 'bridge-1', seq: 2 },
      },
    ]);
  });

  it('sends a line again until the background acks it, every few seconds', () => {
    const { outbox, lines } = setup();
    outbox.send({ level: 'info', message: 'one' });
    outbox.send({ level: 'info', message: 'two' });
    outbox.acked(1);
    vi.advanceTimersByTime(5000);
    expect(lines()).toEqual(['one', 'two', 'two']);
    outbox.acked(2);
    vi.advanceTimersByTime(10_000);
    expect(lines()).toEqual(['one', 'two', 'two']);
  });

  // Lines after one lost with a dropped Port arrive on the new Port first: their acks say
  // nothing about the lost one.
  it('keeps sending a line until its own ack comes, whatever later lines were acked', () => {
    const { outbox, lines } = setup();
    outbox.send({ level: 'info', message: 'lost' });
    outbox.send({ level: 'info', message: 'later' });
    outbox.acked(2);
    vi.advanceTimersByTime(5000);
    expect(lines()).toEqual(['lost', 'later', 'lost']);
  });

  it('waits for a line to go unacked a few seconds before it sends it again', () => {
    const { outbox, lines } = setup();
    vi.advanceTimersByTime(4000);
    outbox.send({ level: 'info', message: 'late' });
    vi.advanceTimersByTime(1000);
    expect(lines()).toEqual(['late']);
    vi.advanceTimersByTime(5000);
    expect(lines()).toEqual(['late', 'late']);
  });

  // A line posted on a Port the background was dropping is lost on its way, without an error.
  it('keeps the lines sent while the Port is down, and sends them once it is back, in order', () => {
    const { outbox, port, lines, posted } = setup();
    port.up = false;
    outbox.send({ level: 'info', message: 'while away' });
    outbox.send({ level: 'info', message: 'still away' });
    vi.advanceTimersByTime(5000);
    expect(lines()).toEqual([]);
    port.up = true;
    vi.advanceTimersByTime(5000);
    expect(lines()).toEqual(['while away', 'still away']);
    // Each keeps the time the bridge got it, not the time it went out.
    expect(posted.map((m) => (m.type === 'log' ? m.at : null))).toEqual([1_000_000, 1_000_000]);
  });

  it('keeps at most so many lines, and says how many it dropped', () => {
    const { outbox, port, lines } = setup({ max: 2 });
    port.up = false;
    for (const message of ['a', 'b', 'c', 'd']) outbox.send({ level: 'info', message });
    port.up = true;
    vi.advanceTimersByTime(5000);
    expect(lines()).toEqual([
      'c',
      'd',
      '2 log lines of this tab were dropped while the extension was not taking them',
    ]);
  });

  it('stops sending again once disposed', () => {
    const { outbox, lines } = setup();
    outbox.send({ level: 'info', message: 'one' });
    outbox.dispose();
    vi.advanceTimersByTime(20_000);
    expect(lines()).toEqual(['one']);
  });
});
