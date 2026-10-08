import { describe, expect, it, vi } from 'vitest';
import { claimPageSession } from './claim-page-session';
import type { PageSession } from './create-page-session';

function fakeSession(): PageSession {
  return {
    start: vi.fn(),
    configure: vi.fn(),
    command: vi.fn(),
    getSnapshot: vi.fn(),
    dispose: vi.fn(),
  } as unknown as PageSession;
}

describe('claimPageSession', () => {
  it('creates the session once and reuses it for later loads', () => {
    const win = {} as Window;
    const first = fakeSession();
    const create = vi.fn(() => first);
    const second = vi.fn(() => fakeSession());
    expect(claimPageSession(win, create)).toBe(first);
    expect(claimPageSession(win, second)).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(Object.keys(win)).toEqual([]);
  });

  it('keeps sessions per window', () => {
    const a = fakeSession();
    const b = fakeSession();
    expect(claimPageSession({} as Window, () => a)).toBe(a);
    expect(claimPageSession({} as Window, () => b)).toBe(b);
  });
});
