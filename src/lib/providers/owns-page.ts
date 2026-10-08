import { isFixtureHost } from '@/lib/providers/is-fixture-host';
import { resolveFixtureProvider } from '@/lib/providers/resolve-fixture-provider';
import type { ProviderDescriptor } from '@/lib/providers/types';

/**
 * Whether a provider's content script should run on this page. On real hosts the manifest match
 * already decided; on the local fixture every provider's script is injected, and the path decides.
 */
export function ownsPage(
  descriptor: ProviderDescriptor,
  location: { hostname: string; pathname: string },
  catalog: ProviderDescriptor[],
): boolean {
  if (!isFixtureHost(location.hostname)) return true;
  return resolveFixtureProvider(location.pathname, catalog)?.id === descriptor.id;
}
