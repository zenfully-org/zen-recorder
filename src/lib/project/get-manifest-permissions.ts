// Imports nothing on purpose: wxt.config.ts loads this file without the "@" alias.

/**
 * The API permissions the manifest asks for. `docs/store/permissions.md` says why the extension
 * needs each one, for addons.mozilla.org's reviewers and for anyone deciding whether to install
 * it; the test fails when the two disagree. The host permissions come from the provider catalog.
 */
export function getManifestPermissions() {
  return ['storage', 'unlimitedStorage', 'downloads', 'notifications', 'alarms'] as const;
}
