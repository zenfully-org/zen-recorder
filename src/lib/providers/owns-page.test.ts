import { describe, expect, it } from 'vitest';
import { ownsPage } from './owns-page';
import type { ProviderDescriptor } from './types';

const descriptor = (id: ProviderDescriptor['id'], fixturePrefix: string): ProviderDescriptor => ({
  id,
  label: id,
  origins: [`https://${id}.example/*`],
  fixturePrefix,
  fixtureHostname: `${id}.example`,
});
const meet = descriptor('meet', '');
const zoom = descriptor('zoom', '/zoom');
const catalog = [meet, zoom];

describe('ownsPage', () => {
  it('trusts the manifest match on real hosts', () => {
    const location = { hostname: 'meet.google.com', pathname: '/zoom/anything' };
    expect(ownsPage(meet, location, catalog)).toBe(true);
    expect(ownsPage(zoom, location, catalog)).toBe(true);
  });

  it('gives each fixture path to exactly one provider', () => {
    const zoomPage = { hostname: 'localhost', pathname: '/zoom/wc/1/join' };
    expect(ownsPage(zoom, zoomPage, catalog)).toBe(true);
    expect(ownsPage(meet, zoomPage, catalog)).toBe(false);
    const meetPage = { hostname: '127.0.0.1', pathname: '/abc-defg-hij' };
    expect(ownsPage(meet, meetPage, catalog)).toBe(true);
    expect(ownsPage(zoom, meetPage, catalog)).toBe(false);
  });

  it('owns nothing on the fixture when no provider claims the path', () => {
    expect(ownsPage(zoom, { hostname: 'localhost', pathname: '/other' }, [zoom])).toBe(false);
  });
});
