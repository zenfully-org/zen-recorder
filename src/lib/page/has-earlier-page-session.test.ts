import { describe, expect, it } from 'vitest';
import { hasEarlierPageSession } from './has-earlier-page-session';

describe('hasEarlierPageSession', () => {
  it('finds the session an earlier build kept under its registered symbol', () => {
    const pageWindow = {};
    Object.defineProperty(pageWindow, Symbol.for('zen-recorder.page-session'), {
      value: { start() {} },
    });
    expect(hasEarlierPageSession(pageWindow)).toBe(true);
  });

  it.each([
    ['a window without it', {}],
    ['no window at all (a content script without wrappedJSObject)', undefined],
    ['null', null],
  ])('finds none on %s', (_name, pageWindow) => {
    expect(hasEarlierPageSession(pageWindow)).toBe(false);
  });
});
