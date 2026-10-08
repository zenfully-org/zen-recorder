import { getSettingsItem } from '@/lib/settings/get-settings-item';
import { loadSettings } from '@/lib/settings/load-settings';
import { parseSettings } from '@/lib/settings/parse-settings';
import type { Settings } from '@/lib/types';

/** Validates and merges a patch into the stored settings; returns the full result. */
export async function saveSettings(patch: unknown): Promise<Settings> {
  const current = await loadSettings();
  const next = parseSettings({ ...current, ...(typeof patch === 'object' && patch ? patch : {}) });
  await getSettingsItem().setValue(next);
  return next;
}
