import { describe, expect, it } from 'vitest';
import { installVisibilitySpoof } from './install-visibility-spoof';

describe('installVisibilitySpoof', () => {
  it('reports the page as visible while installed and restores the native values after', () => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    try {
      const uninstall = installVisibilitySpoof(window);
      expect(document.hidden).toBe(false);
      expect(document.visibilityState).toBe('visible');
      uninstall();
      uninstall();
      expect(document.hidden).toBe(true);
      expect(document.visibilityState).toBe('hidden');
    } finally {
      Reflect.deleteProperty(document, 'hidden');
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('leaves no own properties behind when there were none before', () => {
    const uninstall = installVisibilitySpoof(window);
    expect(Object.getOwnPropertyDescriptor(document, 'hidden')).toBeDefined();
    uninstall();
    expect(Object.getOwnPropertyDescriptor(document, 'hidden')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(document, 'visibilityState')).toBeUndefined();
  });

  it('hides visibilitychange from page listeners until uninstalled', () => {
    let seen = 0;
    const listener = () => seen++;
    document.addEventListener('visibilitychange', listener);
    const uninstall = installVisibilitySpoof(window);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toBe(0);
    uninstall();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toBe(1);
    document.removeEventListener('visibilitychange', listener);
  });
});
