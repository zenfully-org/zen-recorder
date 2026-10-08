import { describe, expect, it } from 'vitest';
import { parseDiagnosticsEntries } from './parse-diagnostics-entries';

describe('parseDiagnosticsEntries', () => {
  it('accepts a valid list', () => {
    const entries = [{ at: 1, level: 'warn', source: 'page', message: 'x' }];
    expect(parseDiagnosticsEntries(entries)).toEqual(entries);
  });

  it.each([
    ['undefined', undefined],
    ['a non-array', { at: 1 }],
    ['a bad level', [{ at: 1, level: 'debug', source: 'page', message: 'x' }]],
    ['a missing field', [{ at: 1, level: 'info', source: 'page' }]],
  ])('returns an empty log for %s', (_label, input) => {
    expect(parseDiagnosticsEntries(input)).toEqual([]);
  });
});
