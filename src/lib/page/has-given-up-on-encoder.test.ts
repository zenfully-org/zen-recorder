import { describe, expect, it } from 'vitest';
import { hasGivenUpOnEncoder } from './has-given-up-on-encoder';

describe('hasGivenUpOnEncoder', () => {
  const config = { maxEncoderRestarts: 3 };

  it('keeps restarting while the failures in a row are within the restarts', () => {
    expect(hasGivenUpOnEncoder({ encoderFailures: 0 }, config)).toBe(false);
    expect(hasGivenUpOnEncoder({ encoderFailures: 3 }, config)).toBe(false);
  });

  it('gives up on the failure after the last restart', () => {
    expect(hasGivenUpOnEncoder({ encoderFailures: 4 }, config)).toBe(true);
  });
});
