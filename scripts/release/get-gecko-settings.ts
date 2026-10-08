// Relative imports only: wxt.config.ts loads this file without the "@" alias.
import { z } from 'zod';
import { getAddOnId } from '../../src/lib/get-add-on-id';

/**
 * Where installed copies of the self-distributed build look for a new version: the update
 * manifest the release workflow publishes on the project's GitHub Pages site.
 */
const UPDATE_URL = 'https://zenfully-org.github.io/zen-recorder/updates.json';

/**
 * `self`: the self-distributed build, signed on addons.mozilla.org's unlisted channel for GitHub
 * Releases. Unset: every other build, the listed release among them.
 */
const Channel = z.enum(['self']).optional();

export interface GeckoSettings {
  id: string;
  strict_min_version: string;
  data_collection_permissions: { required: string[] };
  update_url?: string;
}

/**
 * The manifest's `browser_specific_settings.gecko` for a release channel, read from
 * `ZEN_RECORDER_CHANNEL`. Only the self-distributed build names an update manifest:
 * addons.mozilla.org refuses a listed submission that carries `update_url`. An unknown channel
 * throws, because a typo would otherwise ship a build that never updates.
 */
export function getGeckoSettings(channel: string | undefined): GeckoSettings {
  const parsed = Channel.safeParse(channel === '' ? undefined : channel);
  if (!parsed.success) {
    throw new Error(`ZEN_RECORDER_CHANNEL must be "self" or unset, not ${JSON.stringify(channel)}`);
  }
  const settings = {
    id: getAddOnId(),
    strict_min_version: '140.0',
    data_collection_permissions: { required: ['none'] },
  };
  return parsed.data === 'self' ? { ...settings, update_url: UPDATE_URL } : settings;
}
