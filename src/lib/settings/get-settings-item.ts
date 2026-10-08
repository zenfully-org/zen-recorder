import { storage } from '#imports';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type { Settings } from '@/lib/types';

type SettingsItem = ReturnType<typeof storage.defineItem<Settings>>;

let item: SettingsItem | null = null;

/** The single `local:settings` storage item (versioned; migrations go here). */
export function getSettingsItem(): SettingsItem {
  item ??= storage.defineItem<Settings>('local:settings', {
    fallback: getDefaultSettings(),
    version: 1,
  });
  return item;
}
