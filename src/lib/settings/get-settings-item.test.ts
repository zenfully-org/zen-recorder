import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '#imports';
import { getDefaultSettings } from './get-default-settings';
import { getSettingsItem } from './get-settings-item';

describe('getSettingsItem', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns the same item instance', () => {
    expect(getSettingsItem()).toBe(getSettingsItem());
  });

  it('falls back to the defaults when nothing is stored', async () => {
    expect(await getSettingsItem().getValue()).toEqual(getDefaultSettings());
  });

  it('round-trips a value', async () => {
    const next = { ...getDefaultSettings(), autoRecord: false };
    await getSettingsItem().setValue(next);
    expect(await getSettingsItem().getValue()).toEqual(next);
  });
});
