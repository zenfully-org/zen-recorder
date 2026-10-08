import { describe, expect, it } from 'vitest';
import { parsePageLog } from './parse-page-log';

describe('parsePageLog', () => {
  it('accepts a valid log', () => {
    expect(parsePageLog({ level: 'warn', message: 'hi' })).toEqual({
      level: 'warn',
      message: 'hi',
    });
  });

  it.each([
    ['an unknown level', { level: 'debug', message: 'x' }],
    ['an oversized message', { level: 'info', message: 'x'.repeat(2001) }],
    ['a number', 1],
  ])('rejects %s', (_label, input) => {
    expect(parsePageLog(input)).toBeNull();
  });
});
