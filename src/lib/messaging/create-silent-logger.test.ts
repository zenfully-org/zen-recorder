import { describe, expect, it } from 'vitest';
import { createSilentLogger } from './create-silent-logger';

describe('createSilentLogger', () => {
  it('accepts any arguments and returns nothing', () => {
    const logger = createSilentLogger();
    expect(logger.debug('a', 1)).toBeUndefined();
    expect(logger.log()).toBeUndefined();
    expect(logger.warn({})).toBeUndefined();
    expect(logger.error(new Error('x'))).toBeUndefined();
  });
});
