import { describe, expect, it } from 'vitest';
import { yamlString } from './yaml-string';

describe('yamlString', () => {
  // Always double-quoted: unquoted, YAML would read these as a boolean, null, a date or a number.
  it.each<[string, string]>([
    ['no', '"no"'],
    ['null', '"null"'],
    ['2026-10-04', '"2026-10-04"'],
    ['0123', '"0123"'],
    ['Ben: Carter', '"Ben: Carter"'],
    ['#tag', '"#tag"'],
    ['- dash', '"- dash"'],
    ['Jo "JR" Rocha', '"Jo \\"JR\\" Rocha"'],
    ['C:\\temp', '"C:\\\\temp"'],
    ['Ana\nSouza', '"Ana Souza"'],
    ['\u202eAna\u0007', '"Ana"'],
    ['Chloé Martin | Design', '"Chloé Martin | Design"'],
    ['Ana 👩\u200d💻', '"Ana 👩\u200d💻"'],
  ])('writes %j as %s', (input, expected) => {
    expect(yamlString(input)).toBe(expected);
  });
});
