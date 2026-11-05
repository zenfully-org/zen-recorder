// @vitest-environment node
import { createFakeFetchDeps, fetchFailed } from './fake-fetch-deps';
import { findLatestFirefox } from './find-latest-firefox';

const LINK = 'https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US';
const RELEASE =
  'https://download-installer.cdn.mozilla.net/pub/firefox/releases/159.0.1/linux-x86_64/en-US/firefox-159.0.1.tar.xz';
const HEAD = `fetch HEAD ${LINK}`;

const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { location } });

describe('findLatestFirefox', () => {
  it("reads the release from where Mozilla's link redirects, without following it", async () => {
    const deps = createFakeFetchDeps([redirect(RELEASE)]);

    await expect(findLatestFirefox(LINK, deps)).resolves.toEqual({
      version: '159.0.1',
      url: RELEASE,
    });
    expect(deps.events).toEqual([HEAD]);
  });

  it('asks again after a dropped connection', async () => {
    const deps = createFakeFetchDeps([
      fetchFailed('ECONNRESET', 'read ECONNRESET'),
      redirect(RELEASE),
    ]);

    await expect(findLatestFirefox(LINK, deps)).resolves.toEqual({
      version: '159.0.1',
      url: RELEASE,
    });
    expect(deps.events).toEqual([
      HEAD,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${LINK}: fetch failed (read ECONNRESET)`,
      'wait 3000',
      HEAD,
    ]);
  });

  it.each([404, 200])('fails at once on an HTTP %i that redirects nowhere', async (status) => {
    const deps = createFakeFetchDeps([new Response(null, { status })]);

    await expect(findLatestFirefox(LINK, deps)).rejects.toThrow(
      new Error(`${LINK}: no redirect to a release (HTTP ${status})`),
    );
    expect(deps.events).toEqual([HEAD]);
  });

  it('fails at once on a redirect to an address that names no release', async () => {
    const deps = createFakeFetchDeps([redirect('https://www.mozilla.org/firefox/new/')]);

    await expect(findLatestFirefox(LINK, deps)).rejects.toThrow(
      new Error('no Firefox release in https://www.mozilla.org/firefox/new/'),
    );
    expect(deps.events).toEqual([HEAD]);
  });
});
