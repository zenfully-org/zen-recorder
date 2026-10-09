import { describe, expect, it } from 'vitest';
import { createMonotoneClock } from './create-monotone-clock';

describe('createMonotoneClock', () => {
  it('reads 0 until its source has a value, then follows it', () => {
    let source: number | null = null;
    const clock = createMonotoneClock(() => source);
    expect(clock.read()).toBe(0);
    source = 1_500;
    expect(clock.read()).toBe(1_500);
  });

  it('never goes back', () => {
    let source = 2_000;
    const clock = createMonotoneClock(() => source);
    clock.read();
    source = 1_900;
    expect(clock.read()).toBe(2_000);
  });

  it('stands still once frozen, where the freeze read it', () => {
    let source = 3_000;
    const clock = createMonotoneClock(() => source);
    expect(clock.freeze()).toBe(3_000);
    source = 4_000;
    expect(clock.read()).toBe(3_000);
    expect(clock.freeze()).toBe(3_000);
  });
});
