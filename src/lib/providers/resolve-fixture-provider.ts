import type { ProviderDescriptor } from '@/lib/providers/types';

/**
 * Which provider's fake page a fixture-server path belongs to: the longest `fixturePrefix` that
 * starts the path, else the provider with the empty prefix (it owns every other path).
 */
export function resolveFixtureProvider(
  pathname: string,
  catalog: ProviderDescriptor[],
): ProviderDescriptor | null {
  const candidates = catalog
    .filter(
      ({ fixturePrefix }) =>
        fixturePrefix === '' ||
        pathname === fixturePrefix ||
        pathname.startsWith(`${fixturePrefix}/`),
    )
    .sort((a, b) => b.fixturePrefix.length - a.fixturePrefix.length);
  return candidates[0] ?? null;
}
