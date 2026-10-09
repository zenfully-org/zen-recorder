import { describe, expect, it } from 'vitest';
import type { TabToBackground } from '@/lib/types';
import { createRelayLedger } from './create-relay-ledger';
import { endUnended } from './end-unended';

describe('endUnended', () => {
  it("ends on the Port, with the bridge's own count, every recording without an end, once, and logs it", async () => {
    const ledger = createRelayLedger();
    const started = {
      recordingId: 'r1',
      provider: 'meet' as const,
      meetingCode: 'abc-defg-hij',
      title: 'Standup',
      startedAt: 1,
      mimeType: 'audio/webm;codecs=opus',
      micLabel: null,
    };
    ledger.started(started);
    await ledger.relay(
      { recordingId: 'r1', seq: 0, blob: new Blob(['c0']), timestampMs: 0 },
      async () => undefined,
    );
    const sent: TabToBackground[] = [];
    const logs: string[] = [];
    const deps = {
      ledger,
      port: { send: (m: TabToBackground) => sent.push(m) > 0 },
      log: (m: string) => logs.push(m),
    };
    endUnended(deps);
    const message = 'the page went away: recording r1 ended (pagehide) after 1 chunks';
    expect(logs).toEqual([message]);
    expect(sent).toEqual([
      { type: 'log', log: { level: 'info', message } },
      {
        type: 'recordingEnded',
        info: { recordingId: 'r1', chunkCount: 1, durationMs: 0, reason: 'pagehide', started },
      },
    ]);
    // A page that comes back from the cache and goes again ends nothing twice.
    endUnended(deps);
    expect(sent).toHaveLength(2);
  });
});
