import { describe, expect, it } from 'vitest';
import { getProviderCatalog } from './get-provider-catalog';
import { getProviderDescriptor } from './get-provider-descriptor';

describe('getProviderDescriptor', () => {
  it.each(['meet', 'zoom', 'teams'] as const)('describes %s as the catalog does', (id) => {
    expect(getProviderDescriptor(id)).toEqual(
      getProviderCatalog().find((descriptor) => descriptor.id === id),
    );
  });
});
