// @vitest-environment node
import { pressShortcut, shortcutKeys } from './press-shortcut';

describe('shortcutKeys', () => {
  it.each([
    {
      shortcut: 'Alt+Shift+R',
      keys: [
        { key: 'Alt', code: 'AltLeft', keyCode: 'DOM_VK_ALT' },
        { key: 'Shift', code: 'ShiftLeft', keyCode: 'DOM_VK_SHIFT' },
        { key: 'R', code: 'KeyR', keyCode: 'DOM_VK_R' },
      ],
    },
    {
      shortcut: 'Ctrl+7',
      keys: [
        { key: 'Control', code: 'ControlLeft', keyCode: 'DOM_VK_CONTROL' },
        { key: '7', code: 'Digit7', keyCode: 'DOM_VK_7' },
      ],
    },
  ])('turns $shortcut into its keys, modifiers first', ({ shortcut, keys }) => {
    expect(shortcutKeys(shortcut)).toEqual(keys);
  });

  it.each([
    { shortcut: 'Command+R', reason: 'unsupported modifier Command in Command+R' },
    { shortcut: 'Alt+F5', reason: 'unsupported key F5 in Alt+F5' },
  ])('refuses $shortcut, which it cannot press', ({ shortcut, reason }) => {
    expect(() => shortcutKeys(shortcut)).toThrow(reason);
  });
});

describe('pressShortcut', () => {
  it('runs the key presses in the browser window', async () => {
    const expressions: string[] = [];
    const browser = {
      connection: {
        send: async (method: string, params: object) => {
          if (method === 'browsingContext.getTree') {
            return {
              result: {
                contexts: [{ context: 'w', url: 'chrome://browser/content/browser.xhtml' }],
              },
            };
          }
          if ('expression' in params && typeof params.expression === 'string') {
            expressions.push(params.expression);
          }
          return { result: { type: 'success', result: { type: 'boolean', value: true } } };
        },
      },
    };

    await pressShortcut(browser, 'Alt+Shift+R');
    expect(expressions).toHaveLength(1);
    expect(expressions[0]).toContain('nsITextInputProcessor');
    expect(expressions[0]).toContain(JSON.stringify(shortcutKeys('Alt+Shift+R')));
  });
});
