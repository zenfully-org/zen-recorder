import { describe, expect, it, vi } from 'vitest';
import { watchNavigation } from './watch-navigation';

function createWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const win = {
    history: { pushState, replaceState },
    addEventListener: (type: string, fn: () => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    emit: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
  return { win: win as unknown as Window, pushState, replaceState, emit: win.emit, listeners };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('watchNavigation', () => {
  it('notifies after pushState/replaceState while still calling the originals', async () => {
    const { win, pushState, replaceState } = createWindow();
    const onChange = vi.fn();
    watchNavigation(win, onChange);
    win.history.pushState({}, '', '/abc-defg-hij');
    win.history.replaceState({}, '', '/abc-defg-hij?x');
    expect(pushState).toHaveBeenCalledWith({}, '', '/abc-defg-hij');
    expect(replaceState).toHaveBeenCalledWith({}, '', '/abc-defg-hij?x');
    expect(onChange).not.toHaveBeenCalled();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('notifies on popstate and hashchange', async () => {
    const { win, emit } = createWindow();
    const onChange = vi.fn();
    watchNavigation(win, onChange);
    emit('popstate');
    emit('hashchange');
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('restores the history methods and removes listeners on unwatch', async () => {
    const { win, pushState, emit, listeners } = createWindow();
    const onChange = vi.fn();
    const unwatch = watchNavigation(win, onChange);
    unwatch();
    expect(win.history.pushState).toBe(pushState);
    emit('popstate');
    win.history.pushState({}, '', '/x');
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(listeners.get('popstate')?.size).toBe(0);
  });
});
