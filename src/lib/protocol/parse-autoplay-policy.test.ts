import { describe, expect, it } from 'vitest';
import { parseAutoplayPolicy } from './parse-autoplay-policy';

describe('parseAutoplayPolicy', () => {
  it.each(['allowed', 'allowed-muted', 'disallowed'] as const)('reads %s', (policy) => {
    expect(parseAutoplayPolicy(policy)).toBe(policy);
  });

  it.each([
    ['an unknown policy', 'blocked'],
    ['another type', 1],
    ['nothing', undefined],
  ])('rejects %s', (_label, input) => {
    expect(parseAutoplayPolicy(input)).toBeNull();
  });
});
