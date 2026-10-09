import { describe, expect, it } from 'vitest';
import { parseMeetingEventBatch } from './parse-meeting-event-batch';

const recordingId = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const started = { seq: 0, atMs: 1_700_000_000_000, mediaMs: 0, type: 'recording-started' };
const stopped = {
  seq: 1,
  atMs: 1_700_000_060_000,
  mediaMs: 59_800,
  type: 'recording-stopped',
  reason: 'command',
};
const batch = (events: unknown[], droppedRanges: unknown[] = []) => ({
  recordingId,
  events,
  droppedRanges,
});

describe('parseMeetingEventBatch', () => {
  it('reads a batch of the events it knows', () => {
    expect(parseMeetingEventBatch(batch([started, stopped]))).toEqual({
      batch: batch([started, stopped]),
      rejected: 0,
    });
  });

  it('keeps an event detected while paused', () => {
    const paused = { ...stopped, paused: true };
    expect(parseMeetingEventBatch(batch([paused]))?.batch.events).toEqual([paused]);
  });

  // A seq the page dropped (its queue overflowed) stays a gap.
  it('accepts a gap in the seqs, and the dropped ranges that explain it', () => {
    const later = { ...stopped, seq: 7 };
    expect(parseMeetingEventBatch(batch([started, later], [[1, 6]]))).toEqual({
      batch: batch([started, later], [[1, 6]]),
      rejected: 0,
    });
  });

  // A future page may send events this build does not know: they go, the rest stays.
  it('drops and counts the events it cannot read, one by one', () => {
    const unknown = { seq: 1, atMs: 1, mediaMs: 0, type: 'hand-raised' };
    const broken = { ...stopped, seq: 2, reason: 'meteor' };
    expect(parseMeetingEventBatch(batch([started, unknown, broken]))).toEqual({
      batch: batch([started]),
      rejected: 2,
    });
  });

  it('strips what a newer page adds to an event or the batch', () => {
    const result = parseMeetingEventBatch({
      ...batch([{ ...started, cause: 'manual' }]),
      extra: true,
    });
    expect(result?.batch).toEqual(batch([started]));
  });

  it.each([
    ['no events', batch([])],
    ['201 events', batch(Array.from({ length: 201 }, (_, seq) => ({ ...started, seq })))],
    ['a repeated seq', batch([started, { ...stopped, seq: 0 }])],
    [
      'a descending seq',
      batch([
        { ...started, seq: 5 },
        { ...stopped, seq: 4 },
      ]),
    ],
    ['a seq that is not a whole number', batch([{ ...started, seq: 0.5 }])],
    ['a dropped range that ends before it starts', batch([started], [[5, 3]])],
    ['a dropped range over a seq of the batch', batch([started, stopped], [[1, 1]])],
    ['a recording id that is no uuid', { ...batch([started]), recordingId: 'r1' }],
    ['no batch at all', undefined],
  ])('rejects %s', (_label, input) => {
    expect(parseMeetingEventBatch(input)).toBeNull();
  });
});
