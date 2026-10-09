/**
 * Test builds only: gives the meeting page a handle on its recorder, `window.__zenRecorderPage`,
 * through which the end-to-end run reads the session's snapshot and state, reads who the provider
 * sees in the call, and lowers the page's backlog limit, so a run fills a recording's backlog in
 * seconds. The page recorder calls it behind `import.meta.env.WXT_E2E === '1'`, so a release build
 * leaves it out.
 */
import { z } from 'zod';
import type { PageSession } from '@/lib/page/create-page-session';
import { redactPresence } from '@/lib/page/redact-presence';
import type { MeetingPresence } from '@/lib/providers/types';

export interface ExposedPage {
  /** The provider's reading of the page: the session itself never reads it. */
  readPresence: () => MeetingPresence | null;
  setBacklogLimit: (bytes: number) => void;
}

export function exposePageSession(
  win: Window,
  session: Pick<PageSession, 'debug' | 'getSnapshot'>,
  page: ExposedPage,
): void {
  Object.defineProperty(win, '__zenRecorderPage', {
    value: {
      // Who the provider sees in the call, names left out.
      debug: () => ({ ...session.debug(), presence: redactPresence(page.readPresence()) }),
      snapshot: () => session.getSnapshot(),
      // For the recordings that start from now on; any script in the page can call it.
      setBacklogLimit: (bytes: unknown) => {
        const backlogLimitBytes = z.number().int().positive().parse(bytes);
        page.setBacklogLimit(backlogLimitBytes);
        return { backlogLimitBytes };
      },
    },
    configurable: true,
  });
}
