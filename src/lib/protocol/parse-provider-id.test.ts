import { describe, expect, it } from 'vitest';
import { parseProviderId, providerIdSchema } from './parse-provider-id';

describe('parseProviderId', () => {
  it.each(['meet', 'zoom', 'teams'] as const)('accepts %s', (id) => {
    expect(parseProviderId(id)).toBe(id);
  });

  it.each([['webex'], [''], [null], [undefined], [3]])('rejects %j', (input) => {
    expect(parseProviderId(input)).toBeNull();
  });

  it('exposes the schema for other parsers', () => {
    expect(providerIdSchema.safeParse('zoom').success).toBe(true);
    expect(providerIdSchema.safeParse('skype').success).toBe(false);
  });
});
