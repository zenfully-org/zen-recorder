import { describe, expect, it } from 'vitest';
import type { ChunkMessage, TabToBackground } from '@/lib/types';
import { createRelayLedger } from './create-relay-ledger';
import { relayHandover } from './relay-handover';

const chunk = (seq: number): ChunkMessage => ({
  recordingId: 'r1',
  seq,
  blob: new Blob([`c${seq}`]),
  timestampMs: seq * 3000,
});

describe('relayHandover', () => {
  it('sends the chunks still due in order, then the end, and logs it; nothing for what the background has', async () => {
    const ledger = createRelayLedger();
    await ledger.relay(chunk(0), async () => undefined);
    const sent: TabToBackground[] = [];
    const logs: string[] = [];
    const deps = {
      ledger,
      port: { send: (m: TabToBackground) => sent.push(m) > 0 },
      log: (m: string) => logs.push(m),
    };
    const end = { recordingId: 'r1', chunkCount: 3, durationMs: 7000, reason: 'pagehide' as const };
    relayHandover(
      { recordings: [{ recordingId: 'r1', chunks: [chunk(0), chunk(1), chunk(2)], end }] },
      deps,
    );
    const message =
      'the page went away: it handed over 2 more chunks of recording r1 and its end (3 chunks in all)';
    expect(logs).toEqual([message]);
    expect(sent).toEqual([
      { type: 'chunk', chunk: chunk(1) },
      { type: 'chunk', chunk: chunk(2) },
      { type: 'recordingEnded', info: end },
      { type: 'log', log: { level: 'info', message } },
    ]);
    // Handed over again (the bridge asks once more in its own pagehide): all of it is on its way.
    relayHandover(
      { recordings: [{ recordingId: 'r1', chunks: [chunk(0), chunk(1), chunk(2)], end }] },
      deps,
    );
    expect(sent).toHaveLength(4);
    expect(logs).toHaveLength(1);
  });

  it('sends the chunks of a recording whose stop was under way, without an end', () => {
    const sent: TabToBackground[] = [];
    const deps = {
      ledger: createRelayLedger(),
      port: { send: (m: TabToBackground) => sent.push(m) > 0 },
      log: () => undefined,
    };
    relayHandover({ recordings: [{ recordingId: 'r1', chunks: [chunk(0)], end: null }] }, deps);
    expect(sent.map((m) => m.type)).toEqual(['chunk', 'log']);
    expect(sent[1]).toMatchObject({
      log: { message: 'the page went away: it handed over 1 more chunks of recording r1' },
    });
  });
});
