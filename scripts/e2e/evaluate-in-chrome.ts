/**
 * Runs a script in the test browser's own window (its chrome scope), for what no page can do,
 * such as pressing an extension's keyboard shortcut. Firefox gives WebDriver BiDi the chrome
 * scope only when started with `--remote-allow-system-access` (the harness's `launch` does), and
 * allows one BiDi session, so this sends its commands on Puppeteer's
 * (`evaluateInBrowsingContext`).
 */
import { evaluateInBrowsingContext } from './evaluate-in-browsing-context';

/** The browser window, the one chrome document that holds the tabs. */
const BROWSER_WINDOW = 'chrome://browser/content/browser.xhtml';

/**
 * Evaluates `expression` in the browser window and resolves with its value (awaited when it is a
 * promise). Rejects with the script's exception, or when the browser offers no chrome scope.
 */
export async function evaluateInChrome(browser: object, expression: string): Promise<unknown> {
  return evaluateInBrowsingContext(
    browser,
    {
      scope: 'chrome',
      matches: (url) => url === BROWSER_WINDOW,
      missing: (urls) =>
        `no browser window in the chrome scope (${urls.join(', ') || 'none'}): was Firefox started with --remote-allow-system-access?`,
    },
    expression,
  );
}
