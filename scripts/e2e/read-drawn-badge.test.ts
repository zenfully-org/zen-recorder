// @vitest-environment node
import { readDrawnBadge } from './read-drawn-badge';

const ID = 'recorder@example.org';
const TREE = {
  type: 'success',
  result: { contexts: [{ context: 'main', url: 'chrome://browser/content/browser.xhtml' }] },
};

/** A browser whose window answers every script with `value`; it remembers the scripts. */
function windowAnswering(value: string) {
  const scripts: string[] = [];
  const browser = {
    connection: {
      send: async (method: string, params: object) => {
        if (method === 'browsingContext.getTree') return TREE;
        if ('expression' in params && typeof params.expression === 'string') {
          scripts.push(params.expression);
        }
        return { type: 'success', result: { type: 'success', result: { type: 'string', value } } };
      },
    },
  };
  return { browser, scripts };
}

describe('readDrawnBadge', () => {
  it("reads the text and the widths of the extension's badge in the browser window", async () => {
    const { browser, scripts } = windowAnswering(
      JSON.stringify({ text: 'REC', scrollWidth: 24, clientWidth: 20 }),
    );

    await expect(readDrawnBadge(browser, ID)).resolves.toEqual({
      text: 'REC',
      scrollWidth: 24,
      clientWidth: 20,
    });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(
      JSON.stringify(`toolbarbutton[data-extensionid="${ID}"] .toolbarbutton-badge`),
    );
  });

  it('names the extension when the window has no button of it', async () => {
    const { browser } = windowAnswering('null');

    await expect(readDrawnBadge(browser, ID)).rejects.toThrow(
      `the browser window has no toolbar button of ${ID} with a badge`,
    );
  });

  it('rejects an answer that is not a badge', async () => {
    const { browser } = windowAnswering(JSON.stringify({ text: 'REC' }));

    await expect(readDrawnBadge(browser, ID)).rejects.toThrow();
  });
});
