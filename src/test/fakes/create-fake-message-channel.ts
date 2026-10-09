/**
 * MessageChannel double with the semantics the recorder relies on in Firefox: a message reaches the
 * other port in a later task, waits there until that port is started, and a closed port neither
 * sends nor receives. An event dispatched on a port reaches that port's own listeners before
 * `dispatchEvent` returns, as on any `EventTarget`. Each port records what was posted on it.
 */
export interface FakePort extends EventTarget {
  postMessage(data: unknown): void;
  start(): void;
  close(): void;
  /** Everything posted on this port, delivered or not. */
  readonly posted: unknown[];
  /** Whether `close()` was called on this port. */
  isClosed(): boolean;
  /** Make the next postMessage throw (e.g. DataCloneError). */
  failNextPost(error: unknown): void;
}

export interface FakeMessageChannel {
  port1: FakePort;
  port2: FakePort;
}

interface PortState {
  started: boolean;
  closed: boolean;
  waiting: unknown[];
}

export function createFakeMessageChannel(): FakeMessageChannel {
  const states = new Map<FakePort, PortState>();
  const deliver = (port: FakePort, data: unknown): void => {
    setTimeout(() => {
      if (states.get(port)?.closed) return;
      port.dispatchEvent(Object.assign(new Event('message'), { data }));
    }, 0);
  };
  const createPort = (other: () => FakePort): FakePort => {
    const state: PortState = { started: false, closed: false, waiting: [] };
    let nextError: unknown = null;
    const posted: unknown[] = [];
    const port: FakePort = Object.assign(new EventTarget(), {
      posted,
      postMessage(data: unknown) {
        if (nextError !== null) {
          const error = nextError;
          nextError = null;
          throw error;
        }
        posted.push(data);
        const target = other();
        const targetState = states.get(target);
        if (state.closed || !targetState || targetState.closed) return;
        if (targetState.started) deliver(target, data);
        else targetState.waiting.push(data);
      },
      start() {
        if (state.started) return;
        state.started = true;
        for (const data of state.waiting.splice(0)) deliver(port, data);
      },
      close() {
        state.closed = true;
        state.waiting.length = 0;
      },
      isClosed: () => state.closed,
      failNextPost(error: unknown) {
        nextError = error;
      },
    });
    states.set(port, state);
    return port;
  };
  const port1: FakePort = createPort(() => port2);
  const port2: FakePort = createPort(() => port1);
  return { port1, port2 };
}
