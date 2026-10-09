/**
 * Content-script side of the tab ↔ background Port: reconnects when the event page restarts and
 * provides an ack-awaiting `sendChunk`, `sendEnd` and `sendEvents`.
 */
import type { Browser } from 'wxt/browser';
import { parseBackgroundToTab } from '@/lib/protocol/parse-background-to-tab';
import type {
  BackgroundToTab,
  ChunkMessage,
  MeetingEventBatch,
  RecordingEndedInfo,
  TabSnapshot,
  TabToBackground,
} from '@/lib/types';

export const TAB_PORT_NAME = 'zen-recorder:tab';

export interface BackgroundPort {
  connect(): void;
  connected(): boolean;
  send(message: TabToBackground): boolean;
  sendChunk(chunk: ChunkMessage): Promise<void>;
  /** Resolves once the background stored the end (`endAck`); rejects like `sendChunk`. */
  sendEnd(info: RecordingEndedInfo): Promise<void>;
  /** Resolves once the background stored the batch (`eventsAck` of its last seq). */
  sendEvents(batch: MeetingEventBatch): Promise<void>;
  close(): void;
}

export interface BackgroundPortDeps {
  connect: (info: { name: string }) => Browser.runtime.Port;
  onMessage: (message: BackgroundToTab) => void;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  ackTimeoutMs?: number;
  reconnectDelayMs?: number;
}

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
}

/** The messages a send waits for the background to ack. */
type AckedMessage = Extract<TabToBackground, { type: 'chunk' | 'recordingEnded' | 'events' }>;

/** The key the background's ack of `message` settles. */
function sendKey(message: AckedMessage): string {
  switch (message.type) {
    case 'chunk':
      return `${message.chunk.recordingId}:${message.chunk.seq}`;
    case 'recordingEnded':
      return `${message.info.recordingId}:end`;
    // Apart from the chunks' keys: a chunk ack never settles a batch of events.
    case 'events':
      return `events:${message.batch.recordingId}:${Math.max(...message.batch.events.map((e) => e.seq))}`;
  }
}

/** The key an ack from the background settles; null for any other message. */
function ackKey(message: BackgroundToTab): string | null {
  switch (message.type) {
    case 'ack':
      return `${message.recordingId}:${message.seq}`;
    case 'endAck':
      return `${message.recordingId}:end`;
    case 'eventsAck':
      return `events:${message.recordingId}:${message.seq}`;
    default:
      return null;
  }
}

export function createBackgroundPort(deps: BackgroundPortDeps): BackgroundPort {
  const ackTimeoutMs = deps.ackTimeoutMs ?? 10_000;
  const reconnectDelayMs = deps.reconnectDelayMs ?? 1_000;
  let port: Browser.runtime.Port | null = null;
  let lastSnapshot: TabSnapshot | null = null;
  let closed = false;
  let reconnectTimer = 0;
  const pending = new Map<string, Pending>();

  const failPending = (error: Error): void => {
    for (const entry of pending.values()) {
      deps.clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    deps.clearTimeout(reconnectTimer);
    reconnectTimer = deps.setTimeout(connect, reconnectDelayMs);
  };

  /** Resolves the send waiting for the ack `key`, if any. */
  const settle = (key: string): void => {
    const entry = pending.get(key);
    if (!entry) return;
    deps.clearTimeout(entry.timer);
    pending.delete(key);
    entry.resolve();
  };

  const send = (message: TabToBackground): boolean => {
    if (message.type === 'hello' || message.type === 'snapshot') lastSnapshot = message.snapshot;
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };

  function connect(): void {
    if (closed || port) return;
    let next: Browser.runtime.Port;
    try {
      next = deps.connect({ name: TAB_PORT_NAME });
    } catch {
      scheduleReconnect();
      return;
    }
    port = next;
    next.onMessage.addListener((raw: unknown) => {
      const message = parseBackgroundToTab(raw);
      if (!message) return;
      const key = ackKey(message);
      if (key) settle(key);
      else deps.onMessage(message);
    });
    next.onDisconnect.addListener(() => {
      if (port === next) port = null;
      failPending(new Error('background disconnected'));
      scheduleReconnect();
    });
    if (lastSnapshot) send({ type: 'hello', snapshot: lastSnapshot });
  }

  /** Sends `message` and resolves once the background acks it. */
  const sendAcked = (message: AckedMessage): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const key = sendKey(message);
      const timer = deps.setTimeout(() => {
        pending.delete(key);
        reject(new Error('ack timeout'));
      }, ackTimeoutMs);
      pending.set(key, { resolve, reject, timer });
      if (!send(message)) {
        deps.clearTimeout(timer);
        pending.delete(key);
        reject(new Error('not connected'));
      }
    });

  return {
    connect,
    connected: () => port !== null,
    send,
    sendChunk: (chunk) => sendAcked({ type: 'chunk', chunk }),
    sendEnd: (info) => sendAcked({ type: 'recordingEnded', info }),
    sendEvents: (batch) => sendAcked({ type: 'events', batch }),
    close() {
      closed = true;
      deps.clearTimeout(reconnectTimer);
      port?.disconnect();
      port = null;
      failPending(new Error('closed'));
    },
  };
}
