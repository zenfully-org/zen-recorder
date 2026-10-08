import { isFixtureHost } from '@/lib/providers/is-fixture-host';
import type { MeetingLocation, ProviderDescriptor } from '@/lib/providers/types';

/**
 * The location a provider reasons about. On the local fixture the URL is rewritten to look like
 * the real service (provider hostname, fixture prefix removed), so providers have a single code
 * path for real pages and fake ones.
 */
export function toMeetingLocation(
  location: MeetingLocation,
  descriptor: ProviderDescriptor,
): MeetingLocation {
  const { hostname, pathname, search, hash } = location;
  if (!isFixtureHost(hostname)) return { hostname, pathname, search, hash };
  const prefix = descriptor.fixturePrefix;
  const prefixed = prefix !== '' && (pathname === prefix || pathname.startsWith(`${prefix}/`));
  return {
    hostname: descriptor.fixtureHostname,
    pathname: prefixed ? pathname.slice(prefix.length) || '/' : pathname,
    search,
    hash,
  };
}
