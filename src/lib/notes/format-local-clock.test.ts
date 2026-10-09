import { describe, expect, it } from 'vitest';
import { formatLocalClock } from './format-local-clock';

describe('formatLocalClock', () => {
  const start = '2026-10-25T02:40:00+02:00';

  it('writes the local time of an instant in the start offset', () => {
    expect(formatLocalClock('2026-10-25T02:59:50+02:00', start)).toBe('02:59:50');
  });

  it('adds the offset once it changed, as at the end of summer time', () => {
    expect(formatLocalClock('2026-10-25T02:05:00+01:00', start)).toBe('02:05:00 (UTC+01:00)');
  });
});
