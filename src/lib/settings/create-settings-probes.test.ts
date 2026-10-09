import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { createSettingsProbes } from './create-settings-probes';

describe('createSettingsProbes', () => {
  it('switches the settings the end-to-end run needs, and back', async () => {
    const patches: unknown[] = [];
    const probes = createSettingsProbes(async (patch) => {
      patches.push(patch);
      return getDefaultSettings();
    });
    for (const probe of Object.values(probes)) await probe();
    expect(Object.keys(probes)).toEqual([
      'settings:video-off',
      'settings:video-on',
      'settings:subfolder-local',
      'settings:subfolder-default',
    ]);
    expect(patches).toEqual([
      { videoMode: 'off' },
      { videoMode: 'tiles' },
      { downloadSubfolder: 'meetings.local' },
      { downloadSubfolder: getDefaultSettings().downloadSubfolder },
    ]);
  });
});
