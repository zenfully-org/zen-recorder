import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '#imports';
import type { OverlayPosition } from '@/lib/types';
import { loadOverlayPosition } from './load-overlay-position';
import { saveOverlayPosition } from './save-overlay-position';

describe('saveOverlayPosition', () => {
  beforeEach(() => fakeBrowser.reset());

  it('keeps one position per service', async () => {
    const meet: OverlayPosition = { horizontal: 'left', x: 12, vertical: 'top', y: 300 };
    const teams: OverlayPosition = { horizontal: 'right', x: 40, vertical: 'bottom', y: 8 };
    await saveOverlayPosition('meet', meet);
    await saveOverlayPosition('teams', teams);
    expect(await loadOverlayPosition('meet')).toEqual(meet);
    expect(await loadOverlayPosition('teams')).toEqual(teams);
    expect(await loadOverlayPosition('zoom')).toBeNull();
  });

  it('replaces the earlier position of the same service', async () => {
    await saveOverlayPosition('zoom', { horizontal: 'left', x: 1, vertical: 'top', y: 2 });
    const later: OverlayPosition = { horizontal: 'right', x: 3, vertical: 'bottom', y: 4 };
    await saveOverlayPosition('zoom', later);
    expect(await loadOverlayPosition('zoom')).toEqual(later);
  });
});
