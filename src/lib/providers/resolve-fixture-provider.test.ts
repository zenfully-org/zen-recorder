import { describe, expect, it } from 'vitest';
import { resolveFixtureProvider } from './resolve-fixture-provider';
import type { ProviderDescriptor } from './types';

const descriptor = (id: ProviderDescriptor['id'], fixturePrefix: string): ProviderDescriptor => ({
  id,
  label: id,
  origins: [`https://${id}.example/*`],
  fixturePrefix,
  fixtureHostname: `${id}.example`,
  meetingUrl: () => null,
});

const catalog = [
  descriptor('meet', ''),
  descriptor('zoom', '/zoom'),
  descriptor('teams', '/teams'),
];

describe('resolveFixtureProvider', () => {
  it.each([
    ['/zoom', 'zoom'],
    ['/zoom/', 'zoom'],
    ['/zoom/wc/123/join', 'zoom'],
    ['/teams/v2/', 'teams'],
    ['/abc-defg-hij', 'meet'],
    ['/', 'meet'],
    ['/zoomies', 'meet'],
    ['/landing/zoom/1', 'meet'],
  ])('routes %s to %s', (pathname, id) => {
    expect(resolveFixtureProvider(pathname, catalog)?.id).toBe(id);
  });

  it('prefers the longest matching prefix', () => {
    const nested = [...catalog, descriptor('teams', '/zoom/teams')];
    expect(resolveFixtureProvider('/zoom/teams/x', nested)?.fixturePrefix).toBe('/zoom/teams');
  });

  it('returns null when no provider owns the remaining paths', () => {
    expect(resolveFixtureProvider('/abc-defg-hij', [descriptor('zoom', '/zoom')])).toBeNull();
    expect(resolveFixtureProvider('/x', [])).toBeNull();
  });
});
