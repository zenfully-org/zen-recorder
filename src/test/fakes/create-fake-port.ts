/** runtime.Port double for both ends: records posted messages, lets tests inject messages. */
import type { Browser } from 'wxt/browser';

export interface FakePort extends Browser.runtime.Port {
  posted: unknown[];
  disconnected: boolean;
  receive(message: unknown): void;
  disconnectFromOtherSide(): void;
  failNextPost(): void;
}

/** An extension event whose listeners the double calls itself; rules are not supported. */
function createFakeEvent<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  const event: Browser.events.Event<(...args: Args) => void> = {
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
    hasListener: (listener) => listeners.has(listener),
    hasListeners: () => listeners.size > 0,
    addRules: () => undefined,
    getRules: () => undefined,
    removeRules: () => undefined,
  };
  return { event, listeners };
}

/** The tab a content script's port comes from, as `runtime.onConnect` hands it over. */
function senderTab(id: number): Browser.tabs.Tab {
  return {
    id,
    index: 0,
    windowId: 1,
    active: true,
    highlighted: true,
    selected: true,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    lastAccessed: 0,
  };
}

/** A port named `name`; with `tabId`, one a content script of that tab opened. */
export function createFakePort(name = 'fake', options: { tabId?: number } = {}): FakePort {
  const onMessage = createFakeEvent<[message: unknown, port: Browser.runtime.Port]>();
  const onDisconnect = createFakeEvent<[port: Browser.runtime.Port]>();
  let failNext = false;
  const port: FakePort = {
    name,
    posted: [],
    disconnected: false,
    ...(options.tabId === undefined ? {} : { sender: { tab: senderTab(options.tabId) } }),
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
    onMessage: onMessage.event,
    onDisconnect: onDisconnect.event,
    receive(message: unknown) {
      for (const listener of [...onMessage.listeners]) listener(message, port);
    },
    disconnectFromOtherSide() {
      for (const listener of [...onDisconnect.listeners]) listener(port);
    },
    failNextPost() {
      failNext = true;
    },
  };
  return port;
}
