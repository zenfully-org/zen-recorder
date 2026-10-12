/**
 * Pictures of the extension's own pages (the popup, the Options page). WebDriver BiDi refuses a
 * screenshot of a `moz-extension:` page ("privileged scope"), so the browser window opens the page
 * in a background tab and Firefox draws it itself: `drawSnapshot` of the tab's window, as Firefox's
 * own tab capture does, onto a canvas exported as PNG. The meeting tab stays in front, as a
 * recording tab should.
 */
import type { Browser } from 'puppeteer';
import { z } from 'zod';
import { evaluateInBrowsingContext } from '../e2e/evaluate-in-browsing-context';
import { evaluateInChrome } from '../e2e/evaluate-in-chrome';
import { waitFor } from '../e2e/harness';

/** One extension page to draw. */
export interface ExtensionPicture {
  /** The page's path in the extension, `popup.html`. */
  path: string;
  /** A page script that is true once the page shows what the picture is for. */
  ready: string;
  /** A page script giving the rect to draw, in CSS pixels, as JSON text. */
  frame: string;
  /** Device pixels per CSS pixel of the picture. */
  scale: number;
}

const READY_MS = 20_000;

const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

/** The browser window's tab showing `url`, as a chrome script expression. */
const tabOf = (url: string): string =>
  `gBrowser.tabs.find((tab) => tab.linkedBrowser.currentURI.spec === ${JSON.stringify(url)})`;

/** Draws `picture` from the extension `extensionId` and returns it as PNG bytes. */
export async function drawExtensionPage(
  browser: Browser,
  extensionId: string,
  picture: ExtensionPicture,
): Promise<Buffer> {
  const url = z
    .string()
    .parse(
      await evaluateInChrome(
        browser,
        `WebExtensionPolicy.getByID(${JSON.stringify(extensionId)}).getURL(${JSON.stringify(picture.path)})`,
      ),
    );
  await evaluateInChrome(
    browser,
    `gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }) && true`,
  );
  try {
    const inPage = {
      scope: 'content',
      matches: (address: string) => address === url,
      missing: (urls: string[]) => `no tab shows ${url} (open: ${urls.join(', ')})`,
    } as const;
    await waitFor(
      `${picture.path} ready`,
      () =>
        evaluateInBrowsingContext(browser, inPage, picture.ready).then(
          (ready) => ready === true,
          // Until the tab has loaded, no context has the page's address.
          () => false,
        ),
      READY_MS,
    );
    const frame = frameSchema.parse(
      JSON.parse(z.string().parse(await evaluateInBrowsingContext(browser, inPage, picture.frame))),
    );
    const png = await evaluateInChrome(
      browser,
      `(async () => {
        const window = ${tabOf(url)}.linkedBrowser.browsingContext.currentWindowGlobal;
        const bitmap = await window.drawSnapshot(new DOMRect(${frame.x}, ${frame.y}, ${frame.width}, ${frame.height}), ${picture.scale}, 'white');
        const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return canvas.toDataURL('image/png');
      })()`,
    );
    return Buffer.from(
      z
        .string()
        .parse(png)
        .replace(/^data:image\/png;base64,/, ''),
      'base64',
    );
  } finally {
    await evaluateInChrome(browser, `gBrowser.removeTab(${tabOf(url)}) ?? true`);
  }
}
