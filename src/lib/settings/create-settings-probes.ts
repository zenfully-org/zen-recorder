/**
 * Test builds only: the settings the end-to-end run switches through debug probes, and switches
 * back for the scenarios after it.
 */
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type { Settings } from '@/lib/types';

export function createSettingsProbes(
  save: (patch: Partial<Settings>) => Promise<Settings>,
): Record<string, () => Promise<Settings>> {
  return {
    'settings:video-off': () => save({ videoMode: 'off' }),
    'settings:video-on': () => save({ videoMode: 'tiles' }),
    // A folder name Firefox makes `meetings.local.download`, which its downloads API refuses.
    'settings:subfolder-local': () => save({ downloadSubfolder: 'meetings.local' }),
    'settings:subfolder-default': () =>
      save({ downloadSubfolder: getDefaultSettings().downloadSubfolder }),
  };
}
