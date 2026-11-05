/**
 * What the recorder's status card says, read from its shadow root (which test builds hand to the
 * fixture): its status, the few words beside it when a fault lasts, and the sentence in its
 * details that says the fault in full.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';

const cardSchema = z.object({ status: z.string(), alert: z.string(), notice: z.string() });

/**
 * No function is declared inside `evaluate`: the e2e run's compiler names functions with a helper
 * the page lacks.
 */
export const readStatusCard = async (page: Page) =>
  cardSchema.parse(
    await page.evaluate(() => {
      const root = window.__fixture.cardRoot();
      return {
        status: root?.querySelector('.zr-status')?.textContent ?? '',
        alert: root?.querySelector('.zr-alert')?.textContent ?? '',
        notice: root?.querySelector('.zr-notice')?.textContent ?? '',
      };
    }),
  );
