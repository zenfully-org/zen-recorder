import { describe, expect, it } from 'vitest';
import { createVisibilityWatch } from './create-visibility-watch';
import { installVisibilitySpoof } from './install-visibility-spoof';

/** A page whose real visibility the test sets; `getter: false` leaves it off the prototype. */
function page(options: { getter?: boolean } = {}) {
  const real = { state: 'visible' };
  class FakeDocument extends EventTarget {}
  if (options.getter !== false) {
    Object.defineProperty(FakeDocument.prototype, 'visibilityState', {
      get: () => real.state,
      configurable: true,
    });
  }
  const win = Object.assign(new EventTarget(), {
    Document: FakeDocument,
    document: new FakeDocument(),
  });
  return { win, real };
}

describe('createVisibilityWatch', () => {
  it('reads whether the tab is visible, and reports each change', () => {
    const { win, real } = page();
    const seen: (boolean | null)[] = [];
    const watch = createVisibilityWatch(win, (visible) => seen.push(visible));
    expect(watch.visible()).toBe(true);
    real.state = 'hidden';
    win.dispatchEvent(new Event('visibilitychange'));
    real.state = 'visible';
    win.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([false, true]);
    watch.dispose();
    win.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toHaveLength(2);
  });

  // The spoof makes the page believe it is visible: the notes must still know it is not.
  it('reads the real state under the visibility spoof', () => {
    const { win, real } = page();
    real.state = 'hidden';
    const uninstall = installVisibilitySpoof(win);
    expect(win.document).toHaveProperty('visibilityState', 'visible');
    expect(createVisibilityWatch(win, () => undefined).visible()).toBe(false);
    uninstall();
  });

  it('cannot tell without the getter on the prototype, and says so without throwing', () => {
    const { win } = page({ getter: false });
    const seen: (boolean | null)[] = [];
    const watch = createVisibilityWatch(win, (visible) => seen.push(visible));
    expect(watch.visible()).toBeNull();
    win.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([null]);
  });
});
