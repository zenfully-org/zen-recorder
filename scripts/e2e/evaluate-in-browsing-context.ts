/**
 * Runs a script in one browsing context of the test browser, found by its address: the browser
 * window (the chrome scope, for what no page can do) or a page of the content scope, the
 * extension's own pages included, which Puppeteer lists as no page of its own. Firefox allows one
 * BiDi session, so this sends its commands on Puppeteer's: its BiDi browser keeps the session's
 * connection, which Puppeteer's public API does not expose. The chrome scope needs Firefox started
 * with `--remote-allow-system-access` (the harness's `launch` does).
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

/** The context to run in: its scope, how to know its address, and what to say when it is not there. */
export interface BrowsingContextTarget {
  scope: 'chrome' | 'content';
  matches(url: string): boolean;
  /** The error when no context matches, from the addresses of the scope's contexts. */
  missing(urls: string[]): string;
}

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
 * Evaluates `expression` in the first top-level context of `target`'s scope whose address it
 * matches, and resolves with its value (awaited when it is a promise). Rejects with the script's
 * exception, or with `target.missing` when no context matches.
 */
export async function evaluateInBrowsingContext(
  browser: object,
  target: BrowsingContextTarget,
  expression: string,
): Promise<unknown> {
  if (!hasBidiConnection(browser)) {
    throw new Error('the browser has no WebDriver BiDi connection (Puppeteer with Firefox only)');
  }
  const scope = target.scope === 'chrome' ? { 'moz:scope': 'chrome' } : {};
  const tree = treeSchema.parse(await browser.connection.send('browsingContext.getTree', scope));
  const found = tree.result.contexts.find((context) => target.matches(context.url));
  if (!found) throw new Error(target.missing(tree.result.contexts.map((context) => context.url)));
  const { result } = evaluationSchema.parse(
    await browser.connection.send('script.evaluate', {
      expression,
      target: { context: found.context },
      awaitPromise: true,
      resultOwnership: 'none',
    }),
  );
  if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
