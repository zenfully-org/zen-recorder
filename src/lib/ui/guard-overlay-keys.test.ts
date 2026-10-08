import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardOverlayKeys } from './guard-overlay-keys';

/** Removes what a test added to the window and the document. */
const cleanups: (() => void)[] = [];

function setup() {
  const host = document.createElement('zen-recorder-overlay');
  const elsewhere = document.createElement('button');
  document.body.append(host, elsewhere);
  const onEscape = vi.fn();
  const stop = guardOverlayKeys(window, 'zen-recorder-overlay', onEscape);
  const page = new AbortController();
  cleanups.push(stop, () => page.abort());
  // The page's own listeners, added after the guard (it is installed before any page script).
  const heard: string[] = [];
  const listen = (target: EventTarget, capture: boolean) => {
    for (const type of ['keydown', 'keyup', 'keypress']) {
      target.addEventListener(
        type,
        (event) => heard.push(`${type} ${event instanceof KeyboardEvent ? event.key : '?'}`),
        { capture, signal: page.signal },
      );
    }
  };
  listen(window, true);
  listen(document, true);
  listen(document, false);
  const press = (target: Element, key: string, type = 'keydown') => {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event;
  };
  return { host, elsewhere, onEscape, stop, heard, press };
}

describe('guardOverlayKeys', () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.innerHTML = '';
  });

  it("keeps the keys pressed on the card from the page's listeners, the capturing ones too", () => {
    const { host, heard, press } = setup();
    for (const type of ['keydown', 'keypress', 'keyup']) press(host, ' ', type);
    press(host, 'Enter');
    expect(heard).toEqual([]);
  });

  it("keeps the key's default action, so Enter and Space still press the card's buttons", () => {
    const { host, press } = setup();
    expect(press(host, 'Enter').defaultPrevented).toBe(false);
  });

  it('closes the card on Escape', () => {
    const { host, onEscape, press } = setup();
    press(host, 'Escape', 'keyup');
    press(host, 'a');
    expect(onEscape).not.toHaveBeenCalled();
    press(host, 'Escape');
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('leaves the keys pressed anywhere else on the page alone', () => {
    const { elsewhere, onEscape, heard, press } = setup();
    press(elsewhere, 'Escape');
    expect(heard).toEqual(['keydown Escape', 'keydown Escape', 'keydown Escape']);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('ignores key events aimed at the window itself', () => {
    const { onEscape, heard } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(heard).toEqual(['keydown Escape']);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('stops guarding once removed', () => {
    const { host, heard, stop, press } = setup();
    stop();
    press(host, 'x');
    expect(heard).toEqual(['keydown x', 'keydown x', 'keydown x']);
  });
});
