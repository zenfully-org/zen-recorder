/**
 * Minimal typed request/response messaging over a link (a `MessagePort` the two sides share, or
 * the window for a page session of an earlier build), used between the MAIN-world recorder and the
 * ISOLATED bridge. The response only echoes the request id: echoing the whole request (which
 * contains a Blob) fails across Firefox's world boundary.
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

/** What arrives on the wire is anything the other side, or any script of the page, posted. */
const envelopeSchema = z.discriminatedUnion('kind', [requestSchema, responseSchema]);

type RequestEnvelope = z.infer<typeof requestSchema>;
type ResponseEnvelope = z.infer<typeof responseSchema>;

export type ProtocolMapShape = Record<string, (data: never) => unknown>;

/** Longer than any answer takes: the bridge answers a chunk within its 10 s ack timeout. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface MessengerOptions {
  /** How long a request waits for its answer before it is given up. Default 30 s. */
  timeoutMs?: number;
  /** Told the type of every request the other side sends, before it is handled. */
  onRequest?: (type: string) => void;
}

/** Where the messenger's envelopes go, and where the other side's come from. */
export interface MessageLink {
  /** Throws when the data cannot be posted. */
  post(envelope: unknown): void;
  /** Calls `listener` with the data of every message that arrives; returns how to stop. */
  listen(listener: (data: unknown) => void): () => void;
}

/** The timers a request's timeout runs on. */
export interface MessengerTimers<T = number> {
  setTimeout(handler: () => void, ms: number): T;
  clearTimeout(id: T): void;
}

export interface Messenger<P extends ProtocolMapShape> {
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

interface PendingRequest<T> {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: T;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** What a handler's answer to a request says, as the other side reads it. */
function answerRequest(
  handler: (message: { data: unknown }) => unknown,
  data: unknown,
): Promise<Pick<ResponseEnvelope, 'ok' | 'data' | 'error'>> {
  return Promise.resolve()
    .then(() => handler({ data }))
    .then(
      (result) => ({ ok: true, data: result, error: undefined }),
      (error: unknown) => ({ ok: false, data: undefined, error: toError(error).message }),
    );
}

/** Settles a waiting request with the other side's answer. */
function settleWith<T>(entry: PendingRequest<T>, response: ResponseEnvelope): void {
  if (response.ok) entry.resolve(response.data);
  else
    entry.reject(new Error(typeof response.error === 'string' ? response.error : 'request failed'));
}

export function createLinkMessenger<P extends ProtocolMapShape, T = number>(
  namespace: string,
  link: MessageLink,
  timers: MessengerTimers<T>,
  options: MessengerOptions = {},
): Messenger<P> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const instance = crypto.randomUUID();
  const handlers = new Map<string, (message: { data: unknown }) => unknown>();
  const pending = new Map<string, PendingRequest<T>>();
  let seq = 0;

  /** Removes the request from the ones waiting and stops its timer; null when it is not waiting. */
  const settle = (id: string): PendingRequest<T> | null => {
    const entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    timers.clearTimeout(entry.timer);
    return entry;
  };

  const nextId = (): string => `${instance}:${seq++}`;

  /** Throws when the data cannot be posted. */
  const post = (id: string, type: string, data: unknown): void => {
    const request: RequestEnvelope = { ns: namespace, kind: 'req', id, type, data };
    link.post(request);
  };

  const listener = (data: unknown) => {
    const parsed = envelopeSchema.safeParse(data);
    if (!parsed.success || parsed.data.ns !== namespace) return;
    const env = parsed.data;
    if (env.kind === 'res') {
      const entry = settle(env.id);
      if (entry) settleWith(entry, env);
      return;
    }
    // Both sides of the window listen on it: ignore our own requests.
    if (env.id.startsWith(`${instance}:`)) return;
    options.onRequest?.(env.type);
    const handler = handlers.get(env.type);
    if (!handler) return;
    void answerRequest(handler, env.data).then((answer) =>
      link.post({ ns: namespace, kind: 'res', id: env.id, ...answer }),
    );
  };
  const stopListening = link.listen(listener);

  return {
    sendMessage(type, data) {
      return new Promise((resolve, reject) => {
        const id = nextId();
        const timer = timers.setTimeout(() => {
          pending.delete(id);
          reject(new Error(`no answer to ${type} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          post(id, type, data);
        } catch (error) {
          settle(id);
          reject(toError(error));
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
      stopListening();
      for (const entry of pending.values()) {
        timers.clearTimeout(entry.timer);
        entry.reject(new Error('the messenger was disposed'));
      }
      pending.clear();
    },
  };
}
