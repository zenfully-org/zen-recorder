/**
 * MAIN-world wiring shared by every provider's `*-hook.content.ts`: runs inside the meeting
 * page's own JS realm at document_start, before the page's bundle, so the provider's capture hooks
 * can patch the media APIs. This is where the recording happens. It has NO access to `browser.*`
 * APIs; it talks to the bridge (`runBridge`) via `window.postMessage`. Covered by the e2e run.
 */
import { z } from 'zod';
import { installDisplayMediaStub } from '@/lib/capture/install-display-media-stub';
import { claimPageSession } from '@/lib/page/claim-page-session';
import { MAX_PENDING_BYTES } from '@/lib/page/create-chunk-sender';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { createPageSession } from '@/lib/page/create-page-session';
import { redactPresence } from '@/lib/page/redact-presence';
import { getProviderCatalog } from '@/lib/providers/get-provider-catalog';
import { ownsPage } from '@/lib/providers/owns-page';
import { toMeetingLocation } from '@/lib/providers/to-meeting-location';
import type { MeetingProvider, ProviderDescriptor } from '@/lib/providers/types';

export interface PageRecorderOptions {
  descriptor: ProviderDescriptor;
  createProvider: () => MeetingProvider;
  /** Which frames record. Default: the top frame only. */
  shouldRun?: (win: Window) => boolean;
}

const isTopFrame = (win: Window): boolean => win === win.top;

export function runPageRecorder(options: PageRecorderOptions): void {
  const { descriptor } = options;
  if (!(options.shouldRun ?? isTopFrame)(window)) return;
  if (!ownsPage(descriptor, window.location, getProviderCatalog())) return;
  /** Test builds lower it, so a run fills a recording's backlog in seconds. */
  let backlogLimitBytes = MAX_PENDING_BYTES;
  const provider = options.createProvider();
  const readLocation = () => toMeetingLocation(window.location, descriptor);
  // An extension reload injects this script again while the previous session (and its hooks,
  // mixer and encoder) keeps running: leave it alone instead of recording twice.
  const session = claimPageSession(window, () => {
    // Before every hook the session installs, so they wrap it as they would the browser's own.
    if (import.meta.env['WXT_E2E'] === '1') {
      installDisplayMediaStub({
        mediaDevices: window.navigator.mediaDevices,
        userActivation: window.navigator.userActivation,
        createCanvas: () => window.document.createElement('canvas'),
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (id) => window.clearInterval(id),
      });
    }
    return createPageSession({
      win: window,
      messenger: createPageMessenger(window),
      provider,
      readLocation,
      backlogLimitBytes: () => backlogLimitBytes,
    });
  });
  if (!session) return;
  session.start();
  if (import.meta.env['WXT_E2E'] === '1') {
    Object.defineProperty(window, '__zenRecorderPage', {
      value: {
        // Who the provider sees in the call, names left out: the session itself never reads it.
        debug: () => ({
          ...session.debug(),
          presence: redactPresence(
            provider.readPresence({ location: readLocation(), document: window.document }),
          ),
        }),
        snapshot: () => session.getSnapshot(),
        // For the recordings that start from now on; any script in the page can call it.
        setBacklogLimit: (bytes: unknown) => {
          backlogLimitBytes = z.number().int().positive().parse(bytes);
          return { backlogLimitBytes };
        },
      },
      configurable: true,
    });
  }
}
