import { describe, expect, it } from 'vitest';
import { getOverlayPositionKey } from './get-overlay-position-key';

describe('getOverlayPositionKey', () => {
  it.each([
    ['meet', 'local:overlayPosition:meet'],
    ['zoom', 'local:overlayPosition:zoom'],
    ['teams', 'local:overlayPosition:teams'],
  ] as const)('keeps the %s position in its own local storage key', (provider, key) => {
    expect(getOverlayPositionKey(provider)).toBe(key);
  });
});
