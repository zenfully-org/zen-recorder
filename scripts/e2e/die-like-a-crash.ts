/**
 * Makes the next close of a meeting tab look like a crash, in a test build of the extension. A
 * closed tab's bridge ends its recordings on `pagehide`, and the background ends them once the
 * browser removes the tab. A crashed or killed tab gets neither, so the background's grace
 * interruption and recovery pass take its recording; the e2e run cannot crash a tab itself.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { probe } from './harness';

export async function dieLikeACrash(page: Page): Promise<void> {
  const answer = z
    .object({ endOnPageHide: z.literal(false) })
    .safeParse(await probe(page, 'bridge:no-pagehide-end'));
  if (!answer.success) throw new Error('could not turn off the pagehide end of the bridge');
  const removal = z
    .object({ closesLookLikeACrash: z.number() })
    .safeParse(await probe(page, 'tabs:close-looks-like-a-crash'));
  if (!removal.success) throw new Error("could not make the tab's close look like a crash");
}
