import { describe, expect, it } from 'vitest';
import { remuxStartOffsetMs } from './remux-start-offset-ms';

describe('remuxStartOffsetMs', () => {
  it.each([
    ['a file that starts at 0', 0, 0],
    ["the Opus encoder's lookahead", 0.0065, 7],
    ['a first packet half a second in', 0.5, 500],
    // A packet before 0 means "do not show me": the remux cuts it rather than move the rest.
    ['a first packet before 0', -0.0065, 0],
  ])('%s', (_label, firstTimestampSeconds, expected) => {
    expect(remuxStartOffsetMs(firstTimestampSeconds)).toBe(expected);
  });
});
