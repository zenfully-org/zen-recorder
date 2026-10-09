import { describe, expect, it, vi } from 'vitest';
import { claimPageSession } from './claim-page-session';

/** A window as the claim sees it: an event target with the realm's `Event`. */
function fakeWindow() {
  return Object.assign(new EventTarget(), { Event });
}

/** A session stands for whatever the page recorder creates; the claim never looks inside. */
function fakeSession(name: string) {
  return { name };
}

describe('claimPageSession', () => {
  it('creates the session when no session owns the page, and leaves nothing on the window', () => {
    const win = fakeWindow();
    const keysBefore = Reflect.ownKeys(win);
    const session = fakeSession('first');
    expect(claimPageSession(win, () => session)).toBe(session);
    expect(Reflect.ownKeys(win)).toEqual(keysBefore);
    expect(Reflect.get(win, Symbol.for('zen-recorder.page-session'))).toBeUndefined();
  });

  it('leaves the page to its session when the script is injected again (an extension reload)', () => {
    const win = fakeWindow();
    const first = fakeSession('first');
    const again = vi.fn(() => fakeSession('again'));
    expect(claimPageSession(win, () => first)).toBe(first);
    expect(claimPageSession(win, again)).toBeNull();
    expect(claimPageSession(win, again)).toBeNull();
    expect(again).not.toHaveBeenCalled();
  });

  it('leaves the page to a session of an older build, which marked it with a registered symbol', () => {
    const win = fakeWindow();
    Object.defineProperty(win, Symbol.for('zen-recorder.page-session'), {
      value: fakeSession('older build'),
      configurable: true,
    });
    const create = vi.fn(() => fakeSession('new'));
    expect(claimPageSession(win, create)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('lets one of two scripts that run back to back at document_start record', () => {
    const win = fakeWindow();
    const created: string[] = [];
    const claim = (name: string) =>
      claimPageSession(win, () => {
        created.push(name);
        return fakeSession(name);
      });
    const results = [claim('a'), claim('b')];
    expect(created).toEqual(['a']);
    expect(results.map((result) => result?.name ?? null)).toEqual(['a', null]);
  });

  it('owns the page from the claim on: a script that runs while the session is being created stands down', () => {
    const win = fakeWindow();
    const inner = vi.fn(() => fakeSession('inner'));
    let innerResult: unknown = 'not claimed';
    const outer = claimPageSession(win, () => {
      innerResult = claimPageSession(win, inner);
      return fakeSession('outer');
    });
    expect(outer?.name).toBe('outer');
    expect(innerResult).toBeNull();
    expect(inner).not.toHaveBeenCalled();
  });

  it('leaves the page unclaimed when the session cannot be created, so the next script can try', () => {
    const win = fakeWindow();
    expect(() =>
      claimPageSession(win, () => {
        throw new Error('no AudioContext');
      }),
    ).toThrow('no AudioContext');
    const next = fakeSession('next');
    expect(claimPageSession(win, () => next)).toBe(next);
  });

  it("keeps the claim from the page's own listeners", () => {
    const win = fakeWindow();
    claimPageSession(win, () => fakeSession('first'));
    const seen: string[] = [];
    // A page script registers its listeners after the recorder's, which runs at document_start.
    win.addEventListener('zen-recorder@zenfully-org.github.io:claim-page', (event) => {
      seen.push(event.type);
    });
    win.addEventListener(
      'zen-recorder@zenfully-org.github.io:claim-page',
      (event) => seen.push(`capture ${event.type}`),
      { capture: true },
    );
    expect(claimPageSession(win, () => fakeSession('again'))).toBeNull();
    expect(seen).toEqual([]);
  });

  it('keeps sessions per window', () => {
    const a = fakeSession('a');
    const b = fakeSession('b');
    expect(claimPageSession(fakeWindow(), () => a)).toBe(a);
    expect(claimPageSession(fakeWindow(), () => b)).toBe(b);
  });
});
