import { getSettingsItem } from '@/lib/settings/get-settings-item';
import { parseSettings } from '@/lib/settings/parse-settings';
import type { Settings } from '@/lib/types';

/** Reads settings from storage, validated and completed with defaults. */
export async function loadSettings(): Promise<Settings> {
  return parseSettings(await getSettingsItem().getValue());
}
