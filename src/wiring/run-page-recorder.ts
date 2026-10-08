/**
 * MAIN-world wiring shared by every provider's `*-hook.content.ts`: runs inside the meeting
 * page's own JS realm at document_start, before the page's bundle, so the provider's capture hooks
 * can patch the media APIs. This is where the recording happens. It has NO access to `browser.*`
 * APIs; it talks to the bridge (`runBridge`) via `window.postMessage`. Covered by the e2e run.
 */
import { z } from 'zod';
import { claimPageSession } from '@/lib/page/claim-page-session';
import { MAX_PENDING_BYTES } from '@/lib/page/create-chunk-sender';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { createPageSession } from '@/lib/page/create-page-session';
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
  // An extension reload injects this script again while the previous session (and its hooks,
  // mixer and encoder) keeps running: leave it alone instead of recording twice.
  const session = claimPageSession(window, () =>
    createPageSession({
      win: window,
      messenger: createPageMessenger(window),
      provider: options.createProvider(),
      readLocation: () => toMeetingLocation(window.location, descriptor),
      backlogLimitBytes: () => backlogLimitBytes,
    }),
  );
  if (!session) return;
  session.start();
  if (import.meta.env['WXT_E2E'] === '1') {
    Object.defineProperty(window, '__zenRecorderPage', {
      value: {
        debug: () => session.debug(),
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
