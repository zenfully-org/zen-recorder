import type { MessageLink } from '@/lib/page/create-link-messenger';

/** What the link needs of a window; the real one and the test double both have it. */
export interface LinkWindow {
  location: { origin: string };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * The window as a link, the way a page session of an earlier build talks to the bridge: every
 * script of the page receives what is posted on it, and can post on it too. Only messages the
 * window posted to itself are heard, which leaves out frames. While `isOpen` says no, nothing is
 * posted and nothing is heard.
 */
export function createWindowLink(win: LinkWindow, isOpen: () => boolean = () => true): MessageLink {
  return {
    post(envelope) {
      if (isOpen()) win.postMessage(envelope, win.location.origin);
    },
    listen(listener) {
      const onMessage = (event: MessageEvent): void => {
        if (event.source === win && isOpen()) listener(event.data);
      };
      win.addEventListener('message', onMessage);
      return () => win.removeEventListener('message', onMessage);
    },
  };
}
