/**
 * Delivers a recording's chunks to the bridge strictly in order, one at a time, waiting for an ack,
 * and then its end notice the same way. If the bridge is unreachable (e.g. the extension is
 * reloading, or the background's Port is down) everything is kept and retried, so an outage never
 * reorders or drops data: a chunk dropped from the middle leaves a gap in the file, and the first
 * one is the file's header. The end notice is never dropped either: without it the recording would
 * wait for the next background start.
 *
 * The chunks not acked yet live in the meeting page's memory, about 18 MiB a minute with the default
 * video. The sender keeps all of them, and tells its owner once they hold more than
 * `maxPendingBytes` (`onFull`), so the owner can stop what produces them. The page's other
 * recordings may still hold chunks too (a recording stopped during an outage keeps its own until
 * the extension takes them): `pendingElsewhere` counts them toward the same limit.
 */
import { createAckedSender, type Delivery } from '@/lib/page/create-acked-sender';
import type { ChunkMessage, RecordingEndedInfo } from '@/lib/types';

/**
 * How many bytes of unacked chunks a recording may hold: 3.5 minutes of video at the default
 * 2.5 Mbit/s, more than 2 hours of audio alone at 64 kbit/s.
 */
export const MAX_PENDING_BYTES = 64 * 2 ** 20;

/** The chunks a sender holds that the bridge has not acked yet. */
export interface ChunkBacklog {
  bytes: number;
  chunks: number;
  /** From the oldest of them to the newest, on the recording's timeline. */
  spanMs: number;
  /** What `pendingElsewhere` said the page's other recordings held at that moment. */
  elsewhereBytes: number;
  /** The `maxPendingBytes` they went over. */
  limitBytes: number;
}

export interface ChunkSender {
  enqueue(chunk: ChunkMessage): void;
  /** Sends the recording's end once every chunk is delivered, again until it is acked. */
  end(info: RecordingEndedInfo): void;
  /** Resolves once everything enqueued so far has been acked. */
  whenIdle(): Promise<void>;
  /** True once the end was acked: the background has the whole recording. */
  settled(): boolean;
  /** The chunks not acked yet, in order, and the end not acked yet: for a page that goes away. */
  held(): { chunks: ChunkMessage[]; end: RecordingEndedInfo | null };
  pending(): number;
  /** The bytes of the chunks not acked yet, the one on its way included. */
  pendingBytes(): number;
  delivered(): number;
}

export interface ChunkSenderOptions {
  send(chunk: ChunkMessage): Promise<unknown>;
  sendEnd(info: RecordingEndedInfo): Promise<unknown>;
  ackTimeoutMs?: number;
  retryDelayMs?: number;
  /** Default `MAX_PENDING_BYTES`. */
  maxPendingBytes?: number;
  /**
   * Bytes the page holds for its other recordings that count toward the same limit; read on every
   * chunk. Default none.
   */
  pendingElsewhere?: () => number;
  /**
   * Called once, when the unacked chunks first hold more than `maxPendingBytes` (with what
   * `pendingElsewhere` says); all are kept.
   */
  onFull?: (backlog: ChunkBacklog) => void;
  onDelivered?: (chunk: ChunkMessage) => void;
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export function createChunkSender(options: ChunkSenderOptions): ChunkSender {
  const limitBytes = options.maxPendingBytes ?? MAX_PENDING_BYTES;
  const onFull = options.onFull ?? ((): void => undefined);
  const pendingElsewhere = options.pendingElsewhere ?? (() => 0);

  const queue: ChunkMessage[] = [];
  let pendingBytes = 0;
  let full = false;
  let ending: RecordingEndedInfo | null = null;
  let settled = false;
  let delivered = 0;

  /** The next delivery: the oldest chunk, then the end notice; null once everything is acked. */
  const next = (): Delivery | null => {
    const chunk = queue[0];
    if (chunk) {
      return {
        send: () => options.send(chunk),
        acked: () => {
          queue.shift();
          pendingBytes -= chunk.blob.size;
          delivered++;
          options.onDelivered?.(chunk);
        },
      };
    }
    const info = ending;
    if (!info) return null;
    return {
      send: () => options.sendEnd(info),
      acked: () => {
        ending = null;
        settled = true;
      },
    };
  };
  const delivery = createAckedSender({ ...options, next });

  return {
    enqueue(chunk) {
      const oldest = queue[0] ?? chunk;
      queue.push(chunk);
      pendingBytes += chunk.blob.size;
      if (!full) {
        const elsewhereBytes = pendingElsewhere();
        if (pendingBytes + elsewhereBytes > limitBytes) {
          full = true;
          const spanMs = chunk.timestampMs - oldest.timestampMs;
          onFull({ bytes: pendingBytes, chunks: queue.length, spanMs, elsewhereBytes, limitBytes });
        }
      }
      delivery.kick();
    },
    end(info) {
      ending = info;
      delivery.kick();
    },
    whenIdle: () => delivery.whenIdle(),
    settled: () => settled,
    held: () => ({ chunks: [...queue], end: ending }),
    pending: () => queue.length,
    pendingBytes: () => pendingBytes,
    delivered: () => delivered,
  };
}
