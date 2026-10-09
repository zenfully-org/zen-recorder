/**
 * Runs a script in the test browser's own window (its chrome scope), for what no page can do,
 * such as pressing an extension's keyboard shortcut. Firefox gives WebDriver BiDi the chrome
 * scope only when started with `--remote-allow-system-access` (the harness's `launch` does), and
 * allows one BiDi session, so this sends its commands on Puppeteer's: its BiDi browser keeps the
 * session's connection, which Puppeteer's public API does not expose.
 */
import { z } from 'zod';

/** What this needs of Puppeteer's BiDi connection: one command, one answer. */
interface BidiConnection {
  send(method: string, params: object): Promise<unknown>;
}

const isBidiConnection = (value: unknown): value is BidiConnection =>
  typeof value === 'object' &&
  value !== null &&
  'send' in value &&
  typeof value.send === 'function';

const hasBidiConnection = (browser: object): browser is { connection: BidiConnection } =>
  'connection' in browser && isBidiConnection(browser.connection);

/** The browser window, the one chrome document that holds the tabs. */
const BROWSER_WINDOW = 'chrome://browser/content/browser.xhtml';

const treeSchema = z.object({
  result: z.object({ contexts: z.array(z.object({ context: z.string(), url: z.string() })) }),
});

const evaluationSchema = z.object({
  result: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('success'),
      result: z.object({ type: z.string(), value: z.unknown().optional() }),
    }),
    z.object({
      type: z.literal('exception'),
      exceptionDetails: z.object({ text: z.string() }),
    }),
  ]),
});

/**
 * Evaluates `expression` in the browser window and resolves with its value (awaited when it is a
 * promise). Rejects with the script's exception, or when the browser offers no chrome scope.
 */
export async function evaluateInChrome(browser: object, expression: string): Promise<unknown> {
  if (!hasBidiConnection(browser)) {
    throw new Error('the browser has no WebDriver BiDi connection (Puppeteer with Firefox only)');
  }
  const tree = treeSchema.parse(
    await browser.connection.send('browsingContext.getTree', { 'moz:scope': 'chrome' }),
  );
  const window = tree.result.contexts.find((context) => context.url === BROWSER_WINDOW);
  if (!window) {
    throw new Error(
      `no browser window in the chrome scope (${tree.result.contexts.map((c) => c.url).join(', ') || 'none'}): was Firefox started with --remote-allow-system-access?`,
    );
  }
  const { result } = evaluationSchema.parse(
    await browser.connection.send('script.evaluate', {
      expression,
      target: { context: window.context },
      awaitPromise: true,
      resultOwnership: 'none',
    }),
  );
  if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
