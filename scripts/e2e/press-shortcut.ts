/**
 * Presses an extension's keyboard shortcut in the test browser, as the person's keyboard does.
 * Puppeteer's `page.keyboard` cannot: WebDriver BiDi dispatches its keys inside the page's
 * process, and Firefox handles extension shortcuts in the browser window (a `<key>` element per
 * command), which never sees them. An `nsITextInputProcessor` in the browser window sends trusted
 * key events to the selected tab's page, and from there they reach the window's `<key>` like a
 * real key press.
 */
import { evaluateInChrome } from './evaluate-in-chrome';

/** One key of a shortcut, as `KeyboardEvent` takes it; `keyCode` names a `KeyboardEvent.DOM_VK_*`. */
export interface ShortcutKey {
  key: string;
  code: string;
  keyCode: string;
}

const MODIFIERS: Record<string, ShortcutKey> = {
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 'DOM_VK_ALT' },
  Ctrl: { key: 'Control', code: 'ControlLeft', keyCode: 'DOM_VK_CONTROL' },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 'DOM_VK_SHIFT' },
};

/** The keys of a manifest shortcut such as "Alt+Shift+R", modifiers first: a letter or a digit last. */
export function shortcutKeys(shortcut: string): ShortcutKey[] {
  const names = shortcut.split('+');
  const last = names.pop() ?? '';
  const modifiers = names.map((name) => {
    const modifier = MODIFIERS[name];
    if (!modifier) throw new Error(`unsupported modifier ${name} in ${shortcut}`);
    return modifier;
  });
  if (!/^[A-Z0-9]$/.test(last)) throw new Error(`unsupported key ${last} in ${shortcut}`);
  const code = /\d/.test(last) ? `Digit${last}` : `Key${last}`;
  return [...modifiers, { key: last, code, keyCode: `DOM_VK_${last}` }];
}

/** Presses `shortcut` in the browser window, its keys down in order and up in reverse. */
export async function pressShortcut(browser: object, shortcut: string): Promise<void> {
  const keys = JSON.stringify(shortcutKeys(shortcut));
  await evaluateInChrome(
    browser,
    `(() => {
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      win.gBrowser.selectedBrowser.focus();
      const tip = Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);
      if (!tip.beginInputTransactionForTests(win)) throw new Error('no input transaction');
      const events = ${keys}.map(
        (k) => new win.KeyboardEvent('', { key: k.key, code: k.code, keyCode: win.KeyboardEvent[k.keyCode] }),
      );
      for (const event of events) tip.keydown(event);
      for (const event of events.reverse()) tip.keyup(event);
      return true;
    })()`,
  );
}
