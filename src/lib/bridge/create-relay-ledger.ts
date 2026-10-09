/**
 * What the bridge knows of each recording it relays: how far the page's chunks went (the fallback
 * end on `pagehide` counts them), which ones the background acked, and which chunk or end is on
 * its way on the Port. When the page hands over what it holds as it goes away, the ledger sends
 * what is still due: the Port delivers in order, so a chunk on its way arrives before anything
 * sent now. The page may hand over twice in one `pagehide` (the bridge asks again, in case Firefox
 * cut the first one short), so each item is marked on its way once it was sent, and nothing is
 * sent twice.
 *
 * It also keeps each recording's announcement and sends it with every end that lacks one: a page
 * announces a recording once, and an announcement relayed while the Port was down never reached
 * the background, which can then store it from the end.
 */
import type {
  ChunkMessage,
  HeldRecording,
  RecordingEndedInfo,
  RecordingStartedInfo,
} from '@/lib/types';

interface Entry {
  /** Chunks the page sent so far (`seq` + 1 of the furthest), and how far into the recording. */
  counted: number;
  durationMs: number;
  /** Chunks the background acked: every `seq` below this. */
  acked: number;
  /** Relayed and not acked yet, or handed over: the page is gone, no ack comes for those. */
  onTheirWay: Set<number | 'end'>;
  /** The background acked the end. */
  ended: boolean;
  /** The page's announcement, once the bridge relayed it. */
  announced: RecordingStartedInfo | null;
}

/** Sends one item of a handover on the Port. */
interface HandoverSend {
  chunk(chunk: ChunkMessage): void;
  end(info: RecordingEndedInfo): void;
}

export interface RelayLedger {
  /** The page announced the recording: ended on `pagehide` even without a chunk. */
  started(info: RecordingStartedInfo): void;
  /** Counts a chunk the page sent and relays it with `send`; rejects when `send` does. */
  relay(chunk: ChunkMessage, send: () => Promise<void>): Promise<void>;
  /**
   * Relays the page's end with `send`, given the end to send (with the announcement when the page
   * left it out); once acked, the recording is done.
   */
  relayEnd(
    info: RecordingEndedInfo,
    send: (end: RecordingEndedInfo) => Promise<void>,
  ): Promise<void>;
  /**
   * Sends what is still due of a recording the page hands over: the chunks the background has
   * neither acked nor on its way, then the end unless it is acked or on its way. Counts each and
   * marks it on its way once `send` returned, so a handover cut short sends the rest the next
   * time. Returns what it sent.
   */
  handOver(
    held: HeldRecording,
    send: HandoverSend,
  ): { chunks: ChunkMessage[]; end: RecordingEndedInfo | null };
  /**
   * The ends of the recordings neither ended nor with an end on its way, with the bridge's own
   * count; each only once (a page that comes back from the cache and goes again ends nothing
   * twice).
   */
  takeUnended(): RecordingEndedInfo[];
}

/** `end` with the announcement the bridge relayed, unless it carries one. */
const withStart = (end: RecordingEndedInfo, known: Entry): RecordingEndedInfo =>
  end.started || !known.announced ? end : { ...end, started: known.announced };

/** Marks `key` on its way while `send` runs; `onAck` runs once it resolves. */
async function track(
  sent: Entry,
  key: number | 'end',
  send: () => Promise<void>,
  onAck: () => void,
): Promise<void> {
  sent.onTheirWay.add(key);
  try {
    await send();
    onAck();
  } finally {
    sent.onTheirWay.delete(key);
  }
}

export function createRelayLedger(): RelayLedger {
  const entries = new Map<string, Entry>();
  const entry = (recordingId: string): Entry => {
    const found = entries.get(recordingId);
    if (found) return found;
    const created: Entry = {
      counted: 0,
      durationMs: 0,
      acked: 0,
      onTheirWay: new Set(),
      ended: false,
      announced: null,
    };
    entries.set(recordingId, created);
    return created;
  };
  const count = (chunk: ChunkMessage): Entry => {
    const counted = entry(chunk.recordingId);
    counted.counted = Math.max(counted.counted, chunk.seq + 1);
    counted.durationMs = Math.max(counted.durationMs, chunk.timestampMs);
    return counted;
  };
  return {
    started(info) {
      entry(info.recordingId).announced = info;
    },
    relay(chunk, send) {
      const sent = count(chunk);
      return track(sent, chunk.seq, send, () => {
        sent.acked = Math.max(sent.acked, chunk.seq + 1);
      });
    },
    relayEnd(info, send) {
      const sent = entry(info.recordingId);
      return track(
        sent,
        'end',
        () => send(withStart(info, sent)),
        () => {
          sent.ended = true;
        },
      );
    },
    handOver({ recordingId, chunks, end }, send) {
      const known = entry(recordingId);
      const sent: ChunkMessage[] = [];
      if (known.ended) return { chunks: sent, end: null };
      for (const chunk of chunks) {
        if (chunk.seq < known.acked || known.onTheirWay.has(chunk.seq)) continue;
        send.chunk(chunk);
        count(chunk);
        known.onTheirWay.add(chunk.seq);
        sent.push(chunk);
      }
      if (!end || known.onTheirWay.has('end')) return { chunks: sent, end: null };
      const ending = withStart(end, known);
      send.end(ending);
      known.onTheirWay.add('end');
      return { chunks: sent, end: ending };
    },
    takeUnended: () =>
      [...entries]
        .filter(([, known]) => !known.ended && !known.onTheirWay.has('end'))
        .map(([recordingId, known]) => {
          known.onTheirWay.add('end');
          return {
            recordingId,
            chunkCount: known.counted,
            durationMs: known.durationMs,
            reason: 'pagehide',
            ...(known.announced ? { started: known.announced } : {}),
          };
        }),
  };
}
