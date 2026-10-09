// @vitest-environment node
import { evaluateInChrome } from './evaluate-in-chrome';

/** A browser whose BiDi connection answers each command from `answers`, and remembers it. */
function fakeBrowser(answers: Record<string, unknown>) {
  const sent: { method: string; params: object }[] = [];
  return {
    sent,
    browser: {
      connection: {
        send: async (method: string, params: object) => {
          sent.push({ method, params });
          return answers[method];
        },
      },
    },
  };
}

const TREE = {
  type: 'success',
  result: {
    contexts: [
      { context: 'devtools', url: 'chrome://devtools/content/toolbox.xhtml' },
      { context: 'main', url: 'chrome://browser/content/browser.xhtml' },
    ],
  },
};

describe('evaluateInChrome', () => {
  it('evaluates the script in the browser window and resolves with its value', async () => {
    const { browser, sent } = fakeBrowser({
      'browsingContext.getTree': TREE,
      'script.evaluate': {
        type: 'success',
        result: { type: 'success', result: { type: 'string', value: 'pressed' }, realm: 'r' },
      },
    });

    await expect(evaluateInChrome(browser, '"pressed"')).resolves.toBe('pressed');
    expect(sent).toEqual([
      { method: 'browsingContext.getTree', params: { 'moz:scope': 'chrome' } },
      {
        method: 'script.evaluate',
        params: {
          expression: '"pressed"',
          target: { context: 'main' },
          awaitPromise: true,
          resultOwnership: 'none',
        },
      },
    ]);
  });

  it("rejects with the script's exception", async () => {
    const { browser } = fakeBrowser({
      'browsingContext.getTree': TREE,
      'script.evaluate': {
        type: 'success',
        result: { type: 'exception', exceptionDetails: { text: 'Error: no input transaction' } },
      },
    });

    await expect(evaluateInChrome(browser, 'boom()')).rejects.toThrow(
      'Error: no input transaction',
    );
  });

  it('says what is missing when the chrome scope has no browser window', async () => {
    const { browser } = fakeBrowser({
      'browsingContext.getTree': { type: 'success', result: { contexts: [] } },
    });

    await expect(evaluateInChrome(browser, '1')).rejects.toThrow(
      'no browser window in the chrome scope (none): was Firefox started with --remote-allow-system-access?',
    );
  });

  it('refuses a browser without a WebDriver BiDi connection', async () => {
    await expect(evaluateInChrome({ connection: {} }, '1')).rejects.toThrow(
      'the browser has no WebDriver BiDi connection',
    );
    await expect(evaluateInChrome({}, '1')).rejects.toThrow(
      'the browser has no WebDriver BiDi connection',
    );
  });
});
