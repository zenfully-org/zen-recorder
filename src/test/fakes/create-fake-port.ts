/** runtime.Port double for both ends: records posted messages, lets tests inject messages. */
import type { Browser } from 'wxt/browser';

export interface FakePort extends Browser.runtime.Port {
  posted: unknown[];
  disconnected: boolean;
  receive(message: unknown): void;
  disconnectFromOtherSide(): void;
  failNextPost(): void;
}

export function createFakePort(name = 'fake', sender?: Browser.runtime.MessageSender): FakePort {
  const messageListeners = new Set<(message: unknown, port: Browser.runtime.Port) => void>();
  const disconnectListeners = new Set<(port: Browser.runtime.Port) => void>();
  let failNext = false;
  const port = {
    name,
    posted: [] as unknown[],
    disconnected: false,
    ...(sender ? { sender } : {}),
    postMessage(message: unknown) {
      if (failNext) {
        failNext = false;
        throw new Error('port closed');
      }
      port.posted.push(message);
    },
    disconnect() {
      // Like a real Port: disconnecting locally does not fire our own onDisconnect listeners.
      port.disconnected = true;
    },
    onMessage: {
      addListener: (fn: (message: unknown, port: Browser.runtime.Port) => void) =>
        messageListeners.add(fn),
      removeListener: (fn: (message: unknown, port: Browser.runtime.Port) => void) =>
        messageListeners.delete(fn),
      hasListener: (fn: (message: unknown, port: Browser.runtime.Port) => void) =>
        messageListeners.has(fn),
    },
    onDisconnect: {
      addListener: (fn: (port: Browser.runtime.Port) => void) => disconnectListeners.add(fn),
      removeListener: (fn: (port: Browser.runtime.Port) => void) => disconnectListeners.delete(fn),
      hasListener: (fn: (port: Browser.runtime.Port) => void) => disconnectListeners.has(fn),
    },
    receive(message: unknown) {
      for (const listener of [...messageListeners]) listener(message, port);
    },
    disconnectFromOtherSide() {
      for (const listener of [...disconnectListeners]) listener(port);
    },
    failNextPost() {
      failNext = true;
    },
  } as unknown as FakePort;
  return port;
}
