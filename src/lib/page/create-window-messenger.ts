/**
 * Minimal typed request/response messaging over `window.postMessage`, used between the MAIN-world
 * recorder and the ISOLATED bridge. The response only echoes the request id: echoing the whole
 * request (which contains a Blob) fails across Firefox's world boundary.
 *
 * The other side can be gone for good (the extension disabled or removed while the page records),
 * so a request waits for its answer only so long; a message whose answer nobody needs is a
 * `notify` and waits for nothing.
 */

import { z } from 'zod';

/**
 * Handlers always receive `unknown`: the payload crossed a world boundary, so each one validates it
 * (zod) before use. The protocol map documents what the sender is expected to put there.
 */
type Handler<P, K extends keyof P> = P[K] extends (data: never) => infer R
  ? (message: { data: unknown }) => R | Promise<R>
  : never;
type DataOf<P, K extends keyof P> = P[K] extends (data: infer D) => unknown ? D : never;

const requestSchema = z.object({
  ns: z.string(),
  kind: z.literal('req'),
  id: z.string(),
  type: z.string(),
  // Optional keys: a request without payload (and the envelopes of older sessions) omit them.
  data: z.unknown().optional(),
});

const responseSchema = z.object({
  ns: z.string(),
  kind: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
});

/** What arrives on the wire is anything any script posted to the window. */
const envelopeSchema = z.discriminatedUnion('kind', [requestSchema, responseSchema]);

type RequestEnvelope = z.infer<typeof requestSchema>;
type ResponseEnvelope = z.infer<typeof responseSchema>;

export type ProtocolMapShape = Record<string, (data: never) => unknown>;

/** Longer than any answer takes: the bridge answers a chunk within its 10 s ack timeout. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface WindowMessengerOptions {
  /** How long a request waits for its answer before it is given up. Default 30 s. */
  timeoutMs?: number;
}

export interface WindowMessenger<P extends ProtocolMapShape> {
  /**
   * Resolves with the handler's answer, untyped: it crossed the world boundary too, so a caller
   * that needs it validates it. Rejects when no answer came within the timeout; a later answer is
   * ignored.
   */
  sendMessage<K extends keyof P & string>(type: K, data: DataOf<P, K>): Promise<unknown>;
  /**
   * Posts the same request without waiting for its answer, which is ignored. Throws when the data
   * cannot be posted.
   */
  notify<K extends keyof P & string>(type: K, data: DataOf<P, K>): void;
  onMessage<K extends keyof P & string>(type: K, handler: Handler<P, K>): () => void;
  /** Stops listening and rejects the requests still waiting for their answer. */
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

export function createWindowMessenger<P extends ProtocolMapShape>(
  namespace: string,
  win: Window,
  options: WindowMessengerOptions = {},
): WindowMessenger<P> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const instance = Math.random().toString(36).slice(2, 10);
  const handlers = new Map<string, (message: { data: unknown }) => unknown>();
  const pending = new Map<string, PendingRequest>();
  let seq = 0;

  /** Removes the request from the ones waiting and stops its timer; null when it is not waiting. */
  const settle = (id: string): PendingRequest | null => {
    const entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    win.clearTimeout(entry.timer);
    return entry;
  };

  const nextId = (): string => `${instance}:${seq++}`;

  /** Throws when the data cannot be posted. */
  const post = (id: string, type: string, data: unknown): void => {
    const request: RequestEnvelope = { ns: namespace, kind: 'req', id, type, data };
    win.postMessage(request, win.location.origin);
  };

  const respond = async (
    id: string,
    handler: (message: { data: unknown }) => unknown,
    data: unknown,
  ) => {
    const base = { ns: namespace, kind: 'res', id } as const;
    const response: ResponseEnvelope = await Promise.resolve()
      .then(() => handler({ data }))
      .then(
        (result) => ({ ...base, ok: true, data: result, error: undefined }),
        (error: unknown) => ({
          ...base,
          ok: false,
          data: undefined,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    win.postMessage(response, win.location.origin);
  };

  const listener = (event: MessageEvent) => {
    if (event.source !== win) return;
    const parsed = envelopeSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.ns !== namespace) return;
    const env = parsed.data;
    if (env.kind === 'req') {
      // Both sides listen on the same window: ignore our own requests.
      if (env.id.startsWith(`${instance}:`)) return;
      const handler = handlers.get(env.type);
      if (handler) void respond(env.id, handler, env.data);
      return;
    }
    const entry = settle(env.id);
    if (!entry) return;
    if (env.ok) entry.resolve(env.data);
    else entry.reject(new Error(typeof env.error === 'string' ? env.error : 'request failed'));
  };
  win.addEventListener('message', listener);

  return {
    sendMessage(type, data) {
      return new Promise((resolve, reject) => {
        const id = nextId();
        const timer = win.setTimeout(() => {
          pending.delete(id);
          reject(new Error(`no answer to ${type} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          post(id, type, data);
        } catch (error) {
          settle(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    notify(type, data) {
      post(nextId(), type, data);
    },
    onMessage(type, handler) {
      handlers.set(type, handler);
      return () => {
        if (handlers.get(type) === handler) handlers.delete(type);
      };
    },
    dispose() {
      handlers.clear();
      win.removeEventListener('message', listener);
      for (const entry of pending.values()) {
        win.clearTimeout(entry.timer);
        entry.reject(new Error('the messenger was disposed'));
      }
      pending.clear();
    },
  };
}
