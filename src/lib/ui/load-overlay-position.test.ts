import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser, storage } from '#imports';
import { loadOverlayPosition } from './load-overlay-position';

describe('loadOverlayPosition', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns null while nothing is stored for the service', async () => {
    expect(await loadOverlayPosition('meet')).toBeNull();
  });

  it("reads the service's own position", async () => {
    const zoom = { horizontal: 'left', x: 30, vertical: 'bottom', y: 90 };
    await storage.setItem('local:overlayPosition:zoom', zoom);
    expect(await loadOverlayPosition('zoom')).toEqual(zoom);
    expect(await loadOverlayPosition('meet')).toBeNull();
  });

  it('ignores a stored value it cannot read', async () => {
    await storage.setItem('local:overlayPosition:teams', { horizontal: 'up', x: 1 });
    expect(await loadOverlayPosition('teams')).toBeNull();
  });
});
