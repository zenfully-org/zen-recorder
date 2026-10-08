import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '#imports';
import { getDefaultSettings } from './get-default-settings';
import { getSettingsItem } from './get-settings-item';
import { loadSettings } from './load-settings';

describe('loadSettings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns defaults on a fresh profile', async () => {
    expect(await loadSettings()).toEqual(getDefaultSettings());
  });

  it('repairs a partially corrupted stored value', async () => {
    await getSettingsItem().setValue({
      ...getDefaultSettings(),
      timesliceMs: -1,
      keepRawCopy: true,
    });
    const settings = await loadSettings();
    expect(settings.timesliceMs).toBe(getDefaultSettings().timesliceMs);
    expect(settings.keepRawCopy).toBe(false);
  });

  it('returns stored valid settings', async () => {
    await getSettingsItem().setValue({ ...getDefaultSettings(), startRule: 'onJoin' });
    expect((await loadSettings()).startRule).toBe('onJoin');
  });
});
