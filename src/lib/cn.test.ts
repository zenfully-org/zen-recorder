import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins conditional classes', () => {
    expect(cn('a', false && 'b', { c: true, d: false }, ['e'])).toBe('a c e');
  });

  it('resolves Tailwind conflicts, last wins', () => {
    expect(cn('p-2 text-red-500', 'p-4')).toBe('text-red-500 p-4');
  });
});
