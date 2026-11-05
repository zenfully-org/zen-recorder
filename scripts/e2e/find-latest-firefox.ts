/**
 * The latest Firefox release for one platform: Mozilla's download link redirects to the file of the
 * latest release, whose address names its version. `pnpm setup:firefox` downloads that address,
 * and CI keys its copy of Firefox by that version. Only the redirect is read, never followed.
 */
import { type FetchWithRetriesDeps, fetchWithRetries } from './fetch-with-retries';
import { readFirefoxVersion } from './read-firefox-version';

export async function findLatestFirefox(
  link: string,
  deps: FetchWithRetriesDeps,
): Promise<{ version: string; url: string }> {
  const location = await fetchWithRetries(
    link,
    { method: 'HEAD', redirect: 'manual' },
    async (response) => {
      const target = response.headers.get('location');
      return target === null
        ? {
            ok: false,
            passing: false,
            reason: `no redirect to a release (HTTP ${response.status})`,
          }
        : { ok: true, value: target };
    },
    deps,
  );
  return { version: readFirefoxVersion(location), url: location };
}
