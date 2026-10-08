// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseBaseline } from './parse-baseline';

describe('parseBaseline', () => {
  it('reads the baseline file', () => {
    const text = JSON.stringify({
      'src/lib/a.ts': {
        file: { 'max-lines': 450 },
        'createA > handle': { 'expression-complexity': [5, 4] },
      },
    });
    expect(parseBaseline(text)).toEqual({
      'src/lib/a.ts': {
        file: { 'max-lines': 450 },
        'createA > handle': { 'expression-complexity': [5, 4] },
      },
    });
  });

  it.each([
    { name: 'a list instead of an object', text: '[]' },
    { name: 'a string value', text: '{"a.ts":{"f":{"max-params":"5"}}}' },
    { name: 'a negative value', text: '{"a.ts":{"f":{"max-params":-1}}}' },
    { name: 'text that is not JSON', text: '{' },
  ])('refuses $name', ({ text }) => {
    expect(() => parseBaseline(text)).toThrow(/quality-baseline\.json/);
  });
});
