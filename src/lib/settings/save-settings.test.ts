import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '#imports';
import { getDefaultSettings } from './get-default-settings';
import { loadSettings } from './load-settings';
import { saveSettings } from './save-settings';

describe('saveSettings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('merges a patch and persists it', async () => {
    const result = await saveSettings({ autoRecord: false });
    expect(result).toEqual({ ...getDefaultSettings(), autoRecord: false });
    expect(await loadSettings()).toEqual(result);
  });

  it('keeps earlier changes when applying a second patch', async () => {
    await saveSettings({ autoRecord: false });
    const result = await saveSettings({ overlayEnabled: false });
    expect(result.autoRecord).toBe(false);
    expect(result.overlayEnabled).toBe(false);
  });

  it.each([null, 'x', 42])('ignores a non-object patch (%j)', async (patch) => {
    expect(await saveSettings(patch)).toEqual(getDefaultSettings());
  });

  it('drops invalid fields from the patch', async () => {
    const result = await saveSettings({ timesliceMs: 999_999, keepRawCopy: true });
    expect(result.timesliceMs).toBe(getDefaultSettings().timesliceMs);
    expect(result.keepRawCopy).toBe(false);
  });
});
