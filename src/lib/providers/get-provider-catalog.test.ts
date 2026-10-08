import { describe, expect, it } from 'vitest';
import { getProviderCatalog } from './get-provider-catalog';

describe('getProviderCatalog', () => {
  it('lists every provider once', () => {
    expect(getProviderCatalog().map((descriptor) => descriptor.id)).toEqual([
      'meet',
      'zoom',
      'teams',
    ]);
  });

  it('gives every provider its own fixture prefix, exactly one of them the empty one', () => {
    const prefixes = getProviderCatalog().map((descriptor) => descriptor.fixturePrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.filter((prefix) => prefix === '')).toHaveLength(1);
  });

  it('never shares a host pattern between providers', () => {
    const origins = getProviderCatalog().flatMap((descriptor) => descriptor.origins);
    expect(new Set(origins).size).toBe(origins.length);
  });
});
