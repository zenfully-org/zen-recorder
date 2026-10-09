import { describe, expect, it } from 'vitest';
import type { MeetingEventBatch } from '@/lib/types';
import { relayEvents } from './relay-events';

const recordingId = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const started = { seq: 0, atMs: 1, mediaMs: 0, type: 'recording-started' };

function setup(answer: () => Promise<void> = async () => undefined) {
  const forwarded: MeetingEventBatch[] = [];
  const logs: string[] = [];
  const port = {
    sendEvents: (batch: MeetingEventBatch) => {
      forwarded.push(batch);
      return answer();
    },
  };
  return { port, forwarded, logs, log: (line: string) => logs.push(line) };
}

describe('relayEvents', () => {
  it('forwards a batch and answers once the background stored it', async () => {
    const { port, forwarded, logs, log } = setup();
    const batch = { recordingId, events: [started], droppedRanges: [] };
    await expect(relayEvents(batch, port, log)).resolves.toEqual({ ok: true, rejected: 0 });
    expect(forwarded).toEqual([batch]);
    expect(logs).toEqual([]);
  });

  // Never an error for what the batch holds: the page would send it again forever.
  it('answers a batch it cannot read, by its count, and forwards nothing', async () => {
    const { port, forwarded, logs, log } = setup();
    const broken = { recordingId: 'r1', events: [started, started], droppedRanges: [] };
    await expect(relayEvents(broken, port, log)).resolves.toEqual({ ok: true, rejected: 2 });
    await expect(relayEvents('junk', port, log)).resolves.toEqual({ ok: true, rejected: 0 });
    expect(forwarded).toEqual([]);
    expect(logs).toEqual([
      'meeting events: a batch it cannot read (2 events) is not forwarded',
      'meeting events: a batch it cannot read (0 events) is not forwarded',
    ]);
  });

  it('answers a batch with no event it knows itself, and drops the rest of one quietly but counted', async () => {
    const { port, forwarded, logs, log } = setup();
    const unknown = { seq: 1, atMs: 2, mediaMs: 0, type: 'hand-raised' };
    const onlyUnknown = { recordingId, events: [unknown], droppedRanges: [] };
    await expect(relayEvents(onlyUnknown, port, log)).resolves.toEqual({ ok: true, rejected: 1 });
    expect(forwarded).toEqual([]);
    const mixed = { recordingId, events: [started, unknown], droppedRanges: [] };
    await expect(relayEvents(mixed, port, log)).resolves.toEqual({ ok: true, rejected: 1 });
    expect(forwarded).toEqual([{ recordingId, events: [started], droppedRanges: [] }]);
    expect(logs).toEqual([
      'meeting events: 1 event(s) of a batch cannot be read',
      'meeting events: 1 event(s) of a batch cannot be read',
    ]);
  });

  it('fails like a chunk when the background cannot take it, so the page sends it again', async () => {
    const { port, log } = setup(() => Promise.reject(new Error('not connected')));
    const batch = { recordingId, events: [started], droppedRanges: [] };
    await expect(relayEvents(batch, port, log)).rejects.toThrow('not connected');
  });
});
