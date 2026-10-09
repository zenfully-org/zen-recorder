import { describe, expect, it } from 'vitest';
import type { ChunkMessage, RecordingEndedInfo, RecordingStartedInfo } from '@/lib/types';
import { createRelayLedger } from './create-relay-ledger';

const chunk = (recordingId: string, seq: number): ChunkMessage => ({
  recordingId,
  seq,
  blob: new Blob([`c${seq}`]),
  timestampMs: seq * 3000,
});
const end = (recordingId: string, chunkCount: number): RecordingEndedInfo => ({
  recordingId,
  chunkCount,
  durationMs: chunkCount * 3000,
  reason: 'pagehide',
});
const announce = (recordingId: string): RecordingStartedInfo => ({
  recordingId,
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 1,
  mimeType: 'video/webm;codecs=vp9,opus',
  micLabel: null,
});
const acked = async () => undefined;
const never = () => new Promise<void>(() => undefined);

/** What a handover sent on the Port, in order. */
function port() {
  const sent: (ChunkMessage | RecordingEndedInfo)[] = [];
  return {
    sent,
    send: {
      chunk: (sending: ChunkMessage) => void sent.push(sending),
      end: (info: RecordingEndedInfo) => void sent.push(info),
    },
  };
}

describe('createRelayLedger', () => {
  it('ends a recording the page did not hand over with what it relayed, one without a chunk too', async () => {
    const ledger = createRelayLedger();
    ledger.started(announce('r1'));
    ledger.started(announce('r2'));
    await ledger.relay(chunk('r2', 0), acked);
    void ledger.relay(chunk('r2', 1), never);
    // Announced again when a bridge configures the page: what was counted stays.
    ledger.started(announce('r2'));
    // With their announcements: one sent while the Port was down never reached the background.
    expect(ledger.takeUnended()).toEqual([
      {
        recordingId: 'r1',
        chunkCount: 0,
        durationMs: 0,
        reason: 'pagehide',
        started: announce('r1'),
      },
      {
        recordingId: 'r2',
        chunkCount: 2,
        durationMs: 3000,
        reason: 'pagehide',
        started: announce('r2'),
      },
    ]);
  });

  it('forgets a recording once the background acked its end, even if the page still hands it over', async () => {
    const ledger = createRelayLedger();
    await ledger.relay(chunk('r1', 0), acked);
    await ledger.relayEnd(end('r1', 1), acked);
    expect(ledger.takeUnended()).toEqual([]);
    // The page had not taken the ack in yet when it went away.
    const { sent, send } = port();
    expect(
      ledger.handOver({ recordingId: 'r1', chunks: [chunk('r1', 0)], end: end('r1', 1) }, send),
    ).toEqual({ chunks: [], end: null });
    expect(sent).toEqual([]);
  });

  it('sends only what the background neither has nor has on its way, then the end', async () => {
    const ledger = createRelayLedger();
    await ledger.relay(chunk('r1', 0), acked);
    void ledger.relay(chunk('r1', 1), never);
    const held = {
      recordingId: 'r1',
      chunks: [1, 2, 3].map((seq) => chunk('r1', seq)),
      end: end('r1', 4),
    };
    const { sent, send } = port();
    expect(ledger.handOver(held, send)).toEqual({
      chunks: [chunk('r1', 2), chunk('r1', 3)],
      end: end('r1', 4),
    });
    expect(sent).toEqual([chunk('r1', 2), chunk('r1', 3), end('r1', 4)]);
    // Its end went with the handover: the bridge's own end on pagehide leaves it alone.
    expect(ledger.takeUnended()).toEqual([]);
  });

  it('sends nothing twice when the page hands over again, and the rest of a handover cut short', () => {
    const ledger = createRelayLedger();
    const held = {
      recordingId: 'r1',
      chunks: [0, 1, 2].map((seq) => chunk('r1', seq)),
      end: end('r1', 3),
    };
    // Cut short at chunk 2: Firefox stopped the script, or the Port refused it.
    const cut = new Error('cut short');
    const first = port();
    expect(() =>
      ledger.handOver(held, {
        ...first.send,
        chunk: (sending) => {
          if (sending.seq === 2) throw cut;
          first.send.chunk(sending);
        },
      }),
    ).toThrow(cut);
    expect(first.sent).toEqual([chunk('r1', 0), chunk('r1', 1)]);
    const second = port();
    expect(ledger.handOver(held, second.send)).toEqual({
      chunks: [chunk('r1', 2)],
      end: end('r1', 3),
    });
    expect(second.sent).toEqual([chunk('r1', 2), end('r1', 3)]);
    const third = port();
    expect(ledger.handOver(held, third.send)).toEqual({ chunks: [], end: null });
    expect(third.sent).toEqual([]);
    expect(ledger.takeUnended()).toEqual([]);
  });

  it('sends again what failed on its way: a chunk, and an end that is then still due', async () => {
    const failure = new Error('background disconnected');
    const failed = async () => {
      const ledger = createRelayLedger();
      await expect(ledger.relay(chunk('r1', 0), () => Promise.reject(failure))).rejects.toBe(
        failure,
      );
      await expect(ledger.relayEnd(end('r1', 1), () => Promise.reject(failure))).rejects.toBe(
        failure,
      );
      return ledger;
    };
    expect((await failed()).takeUnended()).toEqual([
      { recordingId: 'r1', chunkCount: 1, durationMs: 0, reason: 'pagehide' },
    ]);
    const { sent, send } = port();
    (await failed()).handOver(
      { recordingId: 'r1', chunks: [chunk('r1', 0)], end: end('r1', 1) },
      send,
    );
    expect(sent).toEqual([chunk('r1', 0), end('r1', 1)]);
  });

  it('does not send an end that is on its way again, and leaves no fallback end for it', () => {
    const ledger = createRelayLedger();
    void ledger.relayEnd(end('r1', 0), never);
    const { sent, send } = port();
    expect(ledger.handOver({ recordingId: 'r1', chunks: [], end: end('r1', 0) }, send)).toEqual({
      chunks: [],
      end: null,
    });
    expect(sent).toEqual([]);
    expect(ledger.takeUnended()).toEqual([]);
  });

  it('counts a handed-over recording without an end toward its fallback end, and hands over one it never saw', () => {
    const ledger = createRelayLedger();
    const { sent, send } = port();
    // Its stop was still under way when the page went away: no end from the page.
    ledger.handOver(
      { recordingId: 'r1', chunks: [chunk('r1', 0), chunk('r1', 1)], end: null },
      send,
    );
    // A recording this bridge never saw: a new bridge after an extension update.
    ledger.handOver({ recordingId: 'r2', chunks: [chunk('r2', 5)], end: end('r2', 6) }, send);
    expect(sent).toEqual([chunk('r1', 0), chunk('r1', 1), chunk('r2', 5), end('r2', 6)]);
    expect(ledger.takeUnended()).toEqual([
      { recordingId: 'r1', chunkCount: 2, durationMs: 3000, reason: 'pagehide' },
    ]);
  });

  it('sends an end with the announcement it relayed, unless the end carries its own', async () => {
    const ledger = createRelayLedger();
    ledger.started(announce('r1'));
    ledger.started(announce('r2'));
    const sent: RecordingEndedInfo[] = [];
    const send = async (info: RecordingEndedInfo) => void sent.push(info);
    // A page session older than the bridge ends a recording without it.
    await ledger.relayEnd(end('r1', 1), send);
    const own = { ...end('r2', 2), started: { ...announce('r2'), title: 'Renamed' } };
    await ledger.relayEnd(own, send);
    expect(sent).toEqual([{ ...end('r1', 1), started: announce('r1') }, own]);
  });

  it('sends a handed-over end with the announcement it relayed too', () => {
    const ledger = createRelayLedger();
    ledger.started(announce('r1'));
    const { sent, send } = port();
    ledger.handOver({ recordingId: 'r1', chunks: [], end: end('r1', 0) }, send);
    expect(sent).toEqual([{ ...end('r1', 0), started: announce('r1') }]);
  });
});
