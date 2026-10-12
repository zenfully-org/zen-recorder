// @vitest-environment node
import { evaluateInBrowsingContext } from './evaluate-in-browsing-context';

/** A browser whose BiDi connection answers each command from `answers`, and remembers it. */
function fakeBrowser(answers: Record<string, unknown>) {
  const sent: { method: string; params: object }[] = [];
  const send = async (method: string, params: object) => {
    sent.push({ method, params });
    return answers[method];
  };
  return { sent, browser: { connection: { send } } };
}

const POPUP = 'moz-extension://0e5c/popup.html';
const TREE = {
  type: 'success',
  result: {
    contexts: [
      { context: 'meeting', url: 'http://localhost:4175/abc-defg-hij' },
      { context: 'popup', url: POPUP },
    ],
  },
};
const ANSWER = {
  type: 'success',
  result: { type: 'success', result: { type: 'number', value: 205 }, realm: 'r' },
};

const inThePopup = {
  scope: 'content',
  matches: (url: string) => url === POPUP,
  missing: (urls: string[]) => `no popup among ${urls.join(', ')}`,
} as const;

describe('evaluateInBrowsingContext', () => {
  it("evaluates the script in the content page it finds by its address, in the page's scope", async () => {
    const { browser, sent } = fakeBrowser({
      'browsingContext.getTree': TREE,
      'script.evaluate': ANSWER,
    });

    await expect(evaluateInBrowsingContext(browser, inThePopup, 'innerHeight')).resolves.toBe(205);
    expect(sent).toEqual([
      { method: 'browsingContext.getTree', params: {} },
      {
        method: 'script.evaluate',
        params: {
          expression: 'innerHeight',
          target: { context: 'popup' },
          awaitPromise: true,
          resultOwnership: 'none',
        },
      },
    ]);
  });

  it('asks for the tree of the chrome scope when the context is part of the browser', async () => {
    const { browser, sent } = fakeBrowser({
      'browsingContext.getTree': {
        type: 'success',
        result: {
          contexts: [{ context: 'window', url: 'chrome://browser/content/browser.xhtml' }],
        },
      },
      'script.evaluate': ANSWER,
    });

    await evaluateInBrowsingContext(
      browser,
      { scope: 'chrome', matches: (url) => url.startsWith('chrome:'), missing: () => 'none' },
      '1',
    );

    expect(sent[0]).toEqual({
      method: 'browsingContext.getTree',
      params: { 'moz:scope': 'chrome' },
    });
    expect(sent[1]?.params).toMatchObject({ target: { context: 'window' } });
  });

  it('says what is there when no context has the address', async () => {
    const { browser } = fakeBrowser({
      'browsingContext.getTree': {
        type: 'success',
        result: { contexts: TREE.result.contexts.slice(0, 1) },
      },
    });

    await expect(evaluateInBrowsingContext(browser, inThePopup, '1')).rejects.toThrow(
      'no popup among http://localhost:4175/abc-defg-hij',
    );
  });
});
