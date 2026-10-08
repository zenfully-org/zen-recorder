// @vitest-environment node
/**
 * The manifest's Firefox block for each release channel. Only the self-distributed build may name
 * an update manifest: addons.mozilla.org refuses a listed submission that carries `update_url`, and
 * Firefox ignores the field for an add-on it installed from there.
 */
import { getAddOnId } from '../../src/lib/get-add-on-id';
import { getGeckoSettings } from './get-gecko-settings';

const UPDATE_URL = 'https://zenfully-org.github.io/zen-recorder/updates.json';

const EVERY_BUILD = {
  id: getAddOnId(),
  strict_min_version: '140.0',
  data_collection_permissions: { required: ['none'] },
};

describe('getGeckoSettings', () => {
  it.each([
    { name: 'no channel (development, CI and listed builds)', channel: undefined },
    { name: 'an empty channel, as `ZEN_RECORDER_CHANNEL= pnpm build` sets it', channel: '' },
  ])('names no update manifest with $name', ({ channel }) => {
    const settings = getGeckoSettings(channel);

    expect(settings).toEqual(EVERY_BUILD);
    expect(settings).not.toHaveProperty('update_url');
  });

  it('points the self-distributed build at the update manifest on the project site', () => {
    expect(getGeckoSettings('self')).toEqual({ ...EVERY_BUILD, update_url: UPDATE_URL });
  });

  it('serves the update manifest over HTTPS, which Firefox requires for an unhashed update check', () => {
    expect(new URL(getGeckoSettings('self').update_url ?? '').protocol).toBe('https:');
  });

  it.each(['Self', 'listed', 'amo', ' self'])(
    'refuses the unknown channel %j instead of building without updates',
    (channel) => {
      expect(() => getGeckoSettings(channel)).toThrow(
        `ZEN_RECORDER_CHANNEL must be "self" or unset, not ${JSON.stringify(channel)}`,
      );
    },
  );
});
