/**
 * Window double for postMessage-based code and DOM event wiring: 'message' events are dispatched
 * asynchronously with `source` set to the window itself (like a real same-window postMessage);
 * other event types can be emitted synchronously. Records target origins so tests can assert them.
 */

type Listener = (event: MessageEvent) => void;

export interface FakeWindow {
  location: { origin: string; pathname: string };
  listeners: Map<string, Set<Listener>>;
  postedOrigins: string[];
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  postMessage(data: unknown, targetOrigin: string): void;
  /** Deliver a 'message' with an arbitrary source (e.g. an iframe). */
  deliver(data: unknown, source: unknown): void;
  /** Emit any other event type synchronously. */
  emit(type: string, event?: unknown): void;
  /** Synchronous, as in a browser: every listener of the event's type runs before it returns. */
  dispatchEvent(event: Event): boolean;
  CustomEvent: typeof CustomEvent;
  /** Make the next postMessage throw (e.g. DataCloneError). */
  failNextPost(error: unknown): void;
  /** The global timers, looked up at each call so Vitest's fake timers drive them. */
  setTimeout(handler: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export function createFakeWindow(origin = 'http://localhost'): FakeWindow {
  let nextError: unknown = null;
  const win: FakeWindow = {
    location: { origin, pathname: '/' },
    listeners: new Map(),
    postedOrigins: [],
    addEventListener(type, listener) {
      win.listeners.set(type, (win.listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener(type, listener) {
      win.listeners.get(type)?.delete(listener);
    },
    postMessage(data, targetOrigin) {
      if (nextError !== null) {
        const error = nextError;
        nextError = null;
        throw error;
      }
      win.postedOrigins.push(targetOrigin);
      setTimeout(() => win.deliver(data, win), 0);
    },
    deliver(data, source) {
      for (const listener of [...(win.listeners.get('message') ?? [])]) {
        listener({ data, source } as unknown as MessageEvent);
      }
    },
    emit(type, event = {}) {
      for (const listener of [...(win.listeners.get(type) ?? [])]) {
        listener(event as MessageEvent);
      }
    },
    dispatchEvent(event) {
      win.emit(event.type, event);
      return true;
    },
    CustomEvent,
    failNextPost(error) {
      nextError = error;
    },
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  return win;
}
