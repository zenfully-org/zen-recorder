import { describe, expect, it, vi } from 'vitest';
import { toggleActiveTab } from './toggle-active-tab';

describe('toggleActiveTab', () => {
  it('starts or stops the recording of the active tab', async () => {
    const toggle = vi.fn(() => true);
    const warn = vi.fn();
    await toggleActiveTab({ queryActiveTab: async () => [{ id: 7 }], toggle, warn });
    expect(toggle).toHaveBeenCalledWith(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['no active tab', []],
    ['an active tab without an id', [{}]],
  ])('does nothing with %s', async (_label, tabs) => {
    const toggle = vi.fn(() => true);
    await toggleActiveTab({ queryActiveTab: async () => tabs, toggle, warn: vi.fn() });
    expect(toggle).not.toHaveBeenCalled();
  });

  it('says in Diagnostics when the browser cannot name the active tab, and resolves', async () => {
    const failure = new Error('no current window');
    const warnings: unknown[][] = [];
    const toggled = toggleActiveTab({
      queryActiveTab: async () => {
        throw failure;
      },
      toggle: () => true,
      warn: (...args) => warnings.push(args),
    });
    await expect(toggled).resolves.toBeUndefined();
    expect(warnings).toEqual([['could not find the active tab for the shortcut:', failure]]);
  });
});
