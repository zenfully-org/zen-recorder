/**
 * The toolbar button's badge as Firefox draws it in the browser window: the text the badge holds,
 * and how wide that text is against the badge. Firefox draws an extension's badge at most 20 px
 * wide (`--toolbarbutton-badge-max-width`, used by `.toolbarbutton-badge` in
 * `chrome://global/skin/toolbarbutton.css`), hides what overflows and adds no ellipsis, so a text
 * wider than the badge is cut: its `scrollWidth` is above its `clientWidth`. The extension's own
 * API gives the text back, never how much of it shows.
 */
import { z } from 'zod';
import { evaluateInChrome } from './evaluate-in-chrome';

const drawnBadgeSchema = z.object({
  text: z.string(),
  scrollWidth: z.number(),
  clientWidth: z.number(),
});
/** The badge's text, the width of its content and of the badge itself, in CSS pixels. */
export type DrawnBadge = z.infer<typeof drawnBadgeSchema>;

/**
 * Reads the badge of the extension `extensionId`'s toolbar button. Rejects when the browser
 * window has no such button (an extension without an action, or one moved off the toolbar).
 */
export async function readDrawnBadge(browser: object, extensionId: string): Promise<DrawnBadge> {
  const selector = `toolbarbutton[data-extensionid="${extensionId}"] .toolbarbutton-badge`;
  // WebDriver BiDi hands an object back as key/value pairs: the window returns JSON text.
  const read = await evaluateInChrome(
    browser,
    `(() => {
      const badge = document.querySelector(${JSON.stringify(selector)});
      return JSON.stringify(badge && {
        text: badge.textContent,
        scrollWidth: badge.scrollWidth,
        clientWidth: badge.clientWidth,
      });
    })()`,
  );
  const drawn = drawnBadgeSchema.nullable().parse(JSON.parse(z.string().parse(read)));
  if (drawn === null) {
    throw new Error(`the browser window has no toolbar button of ${extensionId} with a badge`);
  }
  return drawn;
}
