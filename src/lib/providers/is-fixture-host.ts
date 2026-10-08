const FIXTURE_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * The local fixture server stands in for every provider (e2e builds only: release builds never
 * match these hosts, so this is false wherever the extension actually runs).
 */
export function isFixtureHost(hostname: string): boolean {
  return FIXTURE_HOSTS.has(hostname);
}
