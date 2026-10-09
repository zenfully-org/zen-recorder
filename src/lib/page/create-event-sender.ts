/**
 * Delivers a recording's meeting events to the bridge in batches, in seq order, each until it is
 * acked (`createAckedSender`), so a bridge reload or a background restart delays them and loses
 * none: the background stores each seq once, so a batch sent twice does no harm.
 *
 * A batch goes 2 s after the first event waiting, at once with 50 waiting, and at once when the
 * recording's end is among them, at most 200 events at a time. It is sent only while enabled:
 * an older bridge answers no message it does not know, and the page would send it forever. The
 * queue holds at most `maxPending` events; past that the oldest one `isDroppable` allows goes,
 * and the next batch names its seq (`droppedRanges`). An event it may not drop is always kept.
 */
import { createAckedSender, type Delivery } from '@/lib/page/create-acked-sender';
import type { MeetingEvent, MeetingEventBatch } from '@/lib/types';

const FLUSH_AFTER_MS = 2_000;
const FLUSH_AT = 50;
const MAX_BATCH = 200;
/** About 1.6 MB of events; a 4-hour meeting with 300 people coming and going makes about 1 800. */
const MAX_PENDING = 10_000;

export interface EventSender {
  enqueue(event: MeetingEvent): void;
  /** Sends only while enabled: while the bridge speaks the events protocol. */
  setEnabled(enabled: boolean): void;
  /** Resolves once every event queued so far is acked, or once sending is disabled. */
  whenIdle(): Promise<void>;
  /** The highest seq the bridge acked; -1 before any. */
  lastAckedSeq(): number;
  /** The events not acked yet, the batch on its way included. */
  pending(): number;
  /** The seqs it dropped, in order. */
  dropped(): number[];
}

export interface EventSenderOptions {
  recordingId: string;
  send(batch: MeetingEventBatch): Promise<unknown>;
  /** Whether the queue may drop `event` when it is full; lifecycle events never are. */
  isDroppable(event: MeetingEvent): boolean;
  maxPending?: number;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** `seqs` (ascending) as [from, to] runs. */
const toRanges = (seqs: number[]): [number, number][] =>
  seqs.reduce<[number, number][]>((ranges, seq) => {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === seq - 1) last[1] = seq;
    else ranges.push([seq, seq]);
    return ranges;
  }, []);

/** Past `max` events, takes the oldest one `isDroppable` allows out of `queue`; returns its seq. */
function trimQueue(
  queue: MeetingEvent[],
  max: number,
  isDroppable: (event: MeetingEvent) => boolean,
): number[] {
  if (queue.length <= max) return [];
  const index = queue.findIndex(isDroppable);
  return index === -1 ? [] : queue.splice(index, 1).map((event) => event.seq);
}

export function createEventSender(options: EventSenderOptions): EventSender {
  const maxPending = options.maxPending ?? MAX_PENDING;
  const queue: MeetingEvent[] = [];
  const dropped: number[] = [];
  let unreported: number[] = [];
  let inFlight: MeetingEventBatch | null = null;
  let enabled = false;
  let flushDue = false;
  let flushTimer = false;
  let lastAcked = -1;
  let waiters: (() => void)[] = [];

  const idle = (): boolean => !enabled || (queue.length === 0 && inFlight === null);
  const settle = (): void => {
    if (!idle()) return;
    for (const resolve of waiters) resolve();
    waiters = [];
  };

  const due = (): boolean =>
    flushDue || queue.length >= FLUSH_AT || queue.some((e) => e.type === 'recording-stopped');

  const next = (): Delivery | null => {
    if (!enabled) return null;
    if (!inFlight && queue.length > 0 && due()) {
      inFlight = {
        recordingId: options.recordingId,
        events: queue.splice(0, MAX_BATCH),
        droppedRanges: toRanges(unreported),
      };
      unreported = [];
      flushDue = queue.length > 0 && flushDue;
    }
    const batch = inFlight;
    if (!batch) return null;
    return {
      send: () => options.send(batch),
      acked: () => {
        lastAcked = Math.max(lastAcked, ...batch.events.map((event) => event.seq));
        inFlight = null;
        settle();
      },
    };
  };
  const delivery = createAckedSender({ ...options, next });

  return {
    enqueue(event) {
      queue.push(event);
      // Past the limit, the oldest event it may drop goes, and the next batch says so.
      for (const seq of trimQueue(queue, maxPending, options.isDroppable)) {
        dropped.push(seq);
        unreported = [...unreported, seq].sort((a, b) => a - b);
      }
      if (!flushTimer) {
        flushTimer = true;
        options.setTimeout(() => {
          flushTimer = false;
          flushDue = true;
          delivery.kick();
        }, FLUSH_AFTER_MS);
      }
      delivery.kick();
    },
    setEnabled(next) {
      enabled = next;
      settle();
      delivery.kick();
    },
    whenIdle: () =>
      idle()
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          }),
    lastAckedSeq: () => lastAcked,
    pending: () => queue.length + (inFlight?.events.length ?? 0),
    dropped: () => [...dropped],
  };
}
