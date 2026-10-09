/**
 * Window double for postMessage-based code and DOM event wiring: 'message' events are dispatched
 * asynchronously with `source` set to the window itself (like a real same-window postMessage);
 * other event types can be emitted synchronously. `dispatchEvent` runs the listeners of any other
 * type through a real `EventTarget`, so capturing listeners, `preventDefault` and
 * `stopImmediatePropagation` behave as in a browser. Records target origins so tests can assert
 * them.
 */

type Listener = (event: MessageEvent) => void;

export interface FakeWindow {
  location: { origin: string; pathname: string };
  listeners: Map<string, Set<Listener>>;
  postedOrigins: string[];
  addEventListener(type: string, listener: Listener, options?: { capture: true }): void;
  removeEventListener(type: string, listener: Listener, options?: { capture: true }): void;
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
  const events = new EventTarget();
  /** The listener each one is registered as on `events`, which hands them every kind of event. */
  const forwarders = new Map<Listener, (event: Event) => void>();
  const forwarderOf = (listener: Listener): ((event: Event) => void) => {
    const known = forwarders.get(listener);
    if (known) return known;
    const forwarder = (event: Event): void => {
      Reflect.apply(listener, undefined, [event]);
    };
    forwarders.set(listener, forwarder);
    return forwarder;
  };
  const win: FakeWindow = {
    location: { origin, pathname: '/' },
    listeners: new Map(),
    postedOrigins: [],
    addEventListener(type, listener, options) {
      win.listeners.set(type, (win.listeners.get(type) ?? new Set()).add(listener));
      if (type !== 'message') events.addEventListener(type, forwarderOf(listener), options);
    },
    removeEventListener(type, listener, options) {
      win.listeners.get(type)?.delete(listener);
      if (type !== 'message') events.removeEventListener(type, forwarderOf(listener), options);
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
      return events.dispatchEvent(event);
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
