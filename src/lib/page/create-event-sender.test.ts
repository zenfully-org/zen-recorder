import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingEvent, MeetingEventBatch } from '@/lib/types';
import { createEventSender } from './create-event-sender';

const recordingId = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const started = (seq: number): MeetingEvent => ({
  seq,
  atMs: 1000 + seq,
  mediaMs: seq,
  type: 'recording-started',
});
const stopped = (seq: number): MeetingEvent => ({
  seq,
  atMs: 1000 + seq,
  mediaMs: seq,
  type: 'recording-stopped',
  reason: 'command',
});

function setup(
  options: {
    enabled?: boolean;
    maxPending?: number;
    droppable?: (e: MeetingEvent) => boolean;
  } = {},
) {
  const batches: MeetingEventBatch[] = [];
  let answer: (batch: MeetingEventBatch) => Promise<unknown> = async () => ({ ok: true });
  const sender = createEventSender({
    recordingId,
    send: (batch) => {
      batches.push(batch);
      return answer(batch);
    },
    isDroppable: options.droppable ?? (() => false),
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(Number(id)),
  });
  sender.setEnabled(options.enabled ?? true);
  const seqs = () => batches.map((batch) => batch.events.map((event) => event.seq));
  return {
    sender,
    batches,
    seqs,
    answerWith: (next: typeof answer) => {
      answer = next;
    },
  };
}

describe('createEventSender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a batch 2 s after its first event', async () => {
    const { sender, seqs } = setup();
    for (const seq of [0, 1, 2]) sender.enqueue(started(seq));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(seqs()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seqs()).toEqual([[0, 1, 2]]);
    expect(sender.lastAckedSeq()).toBe(2);
    expect(sender.pending()).toBe(0);
  });

  it('sends at once 50 events, or the end of the recording', async () => {
    const counted = setup();
    for (let seq = 0; seq < 50; seq++) counted.sender.enqueue(started(seq));
    await vi.advanceTimersByTimeAsync(0);
    expect(counted.seqs().map((batch) => batch.length)).toEqual([50]);
    const ended = setup();
    ended.sender.enqueue(started(0));
    ended.sender.enqueue(stopped(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(ended.seqs()).toEqual([[0, 1]]);
  });

  it('sends at most 200 events in a batch', async () => {
    // Queued while the bridge could not take them, as after a reload to an older one.
    const { sender, seqs } = setup({ enabled: false });
    for (let seq = 0; seq < 449; seq++) sender.enqueue(started(seq));
    sender.enqueue(stopped(449));
    sender.setEnabled(true);
    await sender.whenIdle();
    expect(seqs().map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(sender.lastAckedSeq()).toBe(449);
  });

  it('sends the same batch again after an answer that never came', async () => {
    const { sender, batches, answerWith } = setup();
    let answers = 0;
    answerWith(() => (answers++ === 0 ? new Promise(() => undefined) : Promise.resolve()));
    sender.enqueue(stopped(0));
    await vi.advanceTimersByTimeAsync(16_000);
    await sender.whenIdle();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);
    expect(sender.lastAckedSeq()).toBe(0);
  });

  // An older bridge answers no message it does not know: the page would send it forever.
  it('queues without sending while disabled, and is idle meanwhile', async () => {
    const { sender, seqs } = setup({ enabled: false });
    sender.enqueue(stopped(0));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(sender.whenIdle()).resolves.toBeUndefined();
    expect(seqs()).toEqual([]);
    expect(sender.pending()).toBe(1);
    sender.setEnabled(true);
    await sender.whenIdle();
    expect(seqs()).toEqual([[0]]);
  });

  it('lets a wait for it go when it is disabled', async () => {
    const { sender, answerWith } = setup();
    answerWith(() => new Promise(() => undefined));
    sender.enqueue(stopped(0));
    const idle = sender.whenIdle();
    sender.setEnabled(false);
    await expect(idle).resolves.toBeUndefined();
  });
});

describe('createEventSender, a queue past its limit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops the oldest event it may and says which in the next batch', async () => {
    const { sender, batches } = setup({ maxPending: 3, droppable: (e) => e.seq % 2 === 1 });
    for (const seq of [0, 1, 2, 3]) sender.enqueue(started(seq));
    sender.enqueue(stopped(4));
    await sender.whenIdle();
    expect(batches).toEqual([
      {
        recordingId,
        events: [started(0), started(2), stopped(4)],
        droppedRanges: [
          [1, 1],
          [3, 3],
        ],
      },
    ]);
    expect(sender.dropped()).toEqual([1, 3]);
  });

  it('keeps every event it may not drop', async () => {
    const { sender, seqs } = setup({ maxPending: 1 });
    sender.enqueue(started(0));
    sender.enqueue(stopped(1));
    await sender.whenIdle();
    expect(seqs()).toEqual([[0, 1]]);
    expect(sender.dropped()).toEqual([]);
  });
});

describe('createEventSender, dropped seqs next to each other', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names them as one range', async () => {
    const { sender, batches } = setup({ maxPending: 2, droppable: (e) => e.seq > 0 });
    for (const seq of [0, 1, 2, 3]) sender.enqueue(started(seq));
    sender.enqueue(stopped(4));
    await sender.whenIdle();
    expect(batches[0]?.droppedRanges).toEqual([[1, 3]]);
    expect(batches[0]?.events.map((event) => event.seq)).toEqual([0, 4]);
  });
});
