import { describe, expect, it } from 'vitest';
import { formatIsoWithOffset } from './format-iso-with-offset';

describe('formatIsoWithOffset', () => {
  it.each<[string, number, string, string]>([
    ['UTC', Date.UTC(2026, 9, 4, 12, 3, 5), 'UTC', '2026-10-04T12:03:05+00:00'],
    [
      'four hours behind, in summer time',
      Date.UTC(2026, 9, 4, 12, 3, 5),
      'America/New_York',
      '2026-10-04T08:03:05-04:00',
    ],
    [
      'a quarter-hour zone',
      Date.UTC(2026, 9, 4, 12, 3, 5),
      'Asia/Kathmandu',
      '2026-10-04T17:48:05+05:45',
    ],
    [
      'a day later in the zone',
      Date.UTC(2026, 9, 4, 23, 30, 0),
      'Asia/Tokyo',
      '2026-10-05T08:30:00+09:00',
    ],
    [
      'milliseconds, floored',
      Date.UTC(2026, 9, 4, 12, 3, 5, 999),
      'UTC',
      '2026-10-04T12:03:05+00:00',
    ],
    ['midnight', Date.UTC(2026, 9, 4, 22, 0, 0), 'Europe/Berlin', '2026-10-05T00:00:00+02:00'],
  ])('%s', (_label, epochMs, timeZone, expected) => {
    expect(formatIsoWithOffset(epochMs, timeZone)).toBe(expected);
  });

  // Berlin leaves summer time on 2026-10-25 at 01:00 UTC: 02:30 happens twice.
  it('gives each instant its own offset across a change of daylight saving time', () => {
    expect(formatIsoWithOffset(Date.UTC(2026, 9, 25, 0, 30), 'Europe/Berlin')).toBe(
      '2026-10-25T02:30:00+02:00',
    );
    expect(formatIsoWithOffset(Date.UTC(2026, 9, 25, 1, 30), 'Europe/Berlin')).toBe(
      '2026-10-25T02:30:00+01:00',
    );
  });
});
