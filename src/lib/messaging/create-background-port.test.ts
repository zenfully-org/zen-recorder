import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundToTab, MeetingEventBatch, TabSnapshot } from '@/lib/types';
import { createFakePort, type FakePort } from '@/test/fakes/create-fake-port';
import { createBackgroundPort, TAB_PORT_NAME } from './create-background-port';

const snapshot: TabSnapshot = {
  state: 'recording',
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 't',
  recordingId: 'r',
  recordingStartedAt: 1,
  remoteTracks: 1,
  micLabel: null,
  connected: true,
  admitted: true,
};
const chunk = { recordingId: 'r', seq: 0, blob: new Blob(['x']), timestampMs: 0 };
const ended = { recordingId: 'r', chunkCount: 2, durationMs: 6000, reason: 'command' as const };

function setup(options: { failConnect?: number } = {}) {
  const ports: FakePort[] = [];
  const received: BackgroundToTab[] = [];
  let failures = options.failConnect ?? 0;
  const connect = vi.fn((info: { name: string }) => {
    if (failures > 0) {
      failures--;
      throw new Error('no background');
    }
    const port = createFakePort(info.name);
    ports.push(port);
    return port;
  });
  const bg = createBackgroundPort({
    connect,
    onMessage: (m) => received.push(m),
    setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    ackTimeoutMs: 100,
    reconnectDelayMs: 50,
  });
  return { bg, ports, received, connect };
}

describe('createBackgroundPort', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects with the tab port name and reports state', () => {
    const { bg, connect } = setup();
    expect(bg.connected()).toBe(false);
    bg.connect();
    bg.connect();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ name: TAB_PORT_NAME });
    expect(bg.connected()).toBe(true);
  });

  it('sends messages and returns false when not connected or the port throws', () => {
    const { bg, ports } = setup();
    expect(bg.send({ type: 'ping' })).toBe(false);
    bg.connect();
    expect(bg.send({ type: 'ping' })).toBe(true);
    ports[0]?.failNextPost();
    expect(bg.send({ type: 'ping' })).toBe(false);
    expect(ports[0]?.posted).toEqual([{ type: 'ping' }]);
  });

  it('resolves sendChunk on a matching ack and ignores unknown acks', async () => {
    const { bg, ports } = setup();
    bg.connect();
    const port = ports[0];
    if (!port) throw new Error('no port');
    const promise = bg.sendChunk(chunk);
    port.receive({ type: 'ack', recordingId: 'other', seq: 0 });
    port.receive({ type: 'ack', recordingId: 'r', seq: 0 });
    await expect(promise).resolves.toBeUndefined();
    expect(port.posted).toEqual([{ type: 'chunk', chunk }]);
  });

  it('rejects sendChunk when not connected, on timeout, and on disconnect', async () => {
    const { bg, ports } = setup();
    await expect(bg.sendChunk(chunk)).rejects.toThrow('not connected');
    bg.connect();
    const timedOut = bg.sendChunk(chunk);
    vi.advanceTimersByTime(100);
    await expect(timedOut).rejects.toThrow('ack timeout');
    const dropped = bg.sendChunk({ ...chunk, seq: 1 });
    ports[0]?.disconnectFromOtherSide();
    await expect(dropped).rejects.toThrow('background disconnected');
  });

  it('resolves sendEnd on the end ack of its recording only', async () => {
    const { bg, ports, received } = setup();
    bg.connect();
    const port = ports[0];
    if (!port) throw new Error('no port');
    let settled = false;
    const promise = bg.sendEnd(ended).finally(() => {
      settled = true;
    });
    port.receive({ type: 'endAck', recordingId: 'other' });
    port.receive({ type: 'ack', recordingId: 'r', seq: 2 });
    await Promise.resolve();
    expect(settled).toBe(false);
    port.receive({ type: 'endAck', recordingId: 'r' });
    await expect(promise).resolves.toBeUndefined();
    expect(port.posted).toEqual([{ type: 'recordingEnded', info: ended }]);
    expect(received).toEqual([]);
  });

  it('rejects sendEnd when not connected, on timeout, and on disconnect', async () => {
    const { bg, ports } = setup();
    await expect(bg.sendEnd(ended)).rejects.toThrow('not connected');
    bg.connect();
    const timedOut = bg.sendEnd(ended);
    vi.advanceTimersByTime(100);
    await expect(timedOut).rejects.toThrow('ack timeout');
    const dropped = bg.sendEnd(ended);
    ports[0]?.disconnectFromOtherSide();
    await expect(dropped).rejects.toThrow('background disconnected');
  });

  it('forwards other messages after validation and ignores malformed ones', () => {
    const { bg, ports, received } = setup();
    bg.connect();
    ports[0]?.receive({ type: 'command', command: 'pause' });
    ports[0]?.receive({ type: 'nonsense' });
    ports[0]?.receive('garbage');
    expect(received).toEqual([{ type: 'command', command: 'pause' }]);
  });

  it('reconnects after a disconnect and re-announces the last snapshot', () => {
    const { bg, ports, connect } = setup();
    bg.connect();
    bg.send({ type: 'snapshot', snapshot });
    ports[0]?.disconnectFromOtherSide();
    expect(bg.connected()).toBe(false);
    vi.advanceTimersByTime(50);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(ports[1]?.posted).toEqual([{ type: 'hello', snapshot }]);
  });

  it('retries when connect throws', () => {
    const { bg, connect } = setup({ failConnect: 2 });
    bg.connect();
    expect(bg.connected()).toBe(false);
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(bg.connected()).toBe(true);
  });

  it('close disconnects, rejects pending chunks and stops reconnecting', async () => {
    const { bg, ports, connect } = setup();
    bg.connect();
    const pending = bg.sendChunk(chunk);
    const pendingEnd = bg.sendEnd(ended);
    bg.close();
    await expect(pending).rejects.toThrow('closed');
    await expect(pendingEnd).rejects.toThrow('closed');
    expect(bg.connected()).toBe(false);
    // A late disconnect event from the old port must not schedule a reconnect either.
    ports[0]?.disconnectFromOtherSide();
    vi.advanceTimersByTime(1000);
    expect(connect).toHaveBeenCalledTimes(1);
    bg.connect();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(ports).toHaveLength(1);
  });

  it('uses default ack and reconnect delays', async () => {
    const ports: FakePort[] = [];
    const bg = createBackgroundPort({
      connect: (info) => {
        const port = createFakePort(info.name);
        ports.push(port);
        return port;
      },
      onMessage: () => undefined,
      setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id),
    });
    bg.connect();
    const pending = bg.sendChunk(chunk);
    vi.advanceTimersByTime(9_999);
    ports[0]?.disconnectFromOtherSide();
    await expect(pending).rejects.toThrow('background disconnected');
    vi.advanceTimersByTime(999);
    expect(ports).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(2);
    const timedOut = bg.sendChunk(chunk);
    vi.advanceTimersByTime(10_000);
    await expect(timedOut).rejects.toThrow('ack timeout');
  });

  it('ignores a stale disconnect from a port that was already replaced', () => {
    const { bg, ports } = setup();
    bg.connect();
    const first = ports[0];
    if (!first) throw new Error('no port');
    first.disconnectFromOtherSide();
    vi.advanceTimersByTime(50);
    expect(bg.connected()).toBe(true);
    first.disconnectFromOtherSide();
    expect(bg.connected()).toBe(true);
  });
});

describe('createBackgroundPort, meeting events', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const batch: MeetingEventBatch = {
    recordingId: 'r',
    events: [
      { seq: 4, atMs: 1, mediaMs: 0, type: 'recording-started' },
      { seq: 6, atMs: 2, mediaMs: 9, type: 'recording-stopped', reason: 'command' },
    ],
    droppedRanges: [[5, 5]],
  };

  // Keyed by the batch's last seq, apart from the chunks', so a chunk ack never settles it.
  it('resolves sendEvents on the events ack of its last seq only', async () => {
    const { bg, ports, received } = setup();
    bg.connect();
    const port = ports[0];
    if (!port) throw new Error('no port');
    let settled = false;
    const promise = bg.sendEvents(batch).finally(() => {
      settled = true;
    });
    port.receive({ type: 'ack', recordingId: 'r', seq: 6 });
    port.receive({ type: 'eventsAck', recordingId: 'r', seq: 5 });
    await Promise.resolve();
    expect(settled).toBe(false);
    port.receive({ type: 'eventsAck', recordingId: 'r', seq: 6 });
    await expect(promise).resolves.toBeUndefined();
    expect(port.posted).toEqual([{ type: 'events', batch }]);
    expect(received).toEqual([]);
  });

  it('rejects sendEvents when not connected and on timeout', async () => {
    const { bg } = setup();
    await expect(bg.sendEvents(batch)).rejects.toThrow('not connected');
    bg.connect();
    const timedOut = bg.sendEvents(batch);
    vi.advanceTimersByTime(100);
    await expect(timedOut).rejects.toThrow('ack timeout');
  });
});
