// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readRuleThreshold } from './read-rule-threshold';

describe('readRuleThreshold', () => {
  it.each([
    { entry: [2, 15], expected: 15, shape: 'a number' },
    { entry: [2, { threshold: 10 }], expected: 10, shape: '{ threshold }' },
    { entry: [2, { maximum: 80 }], expected: 80, shape: '{ maximum }' },
    { entry: [2, { max: 3 }], expected: 3, shape: '{ max }' },
    { entry: ['error', 4], expected: 4, shape: 'a severity by name' },
  ])('reads the threshold given as $shape', ({ entry, expected }) => {
    expect(readRuleThreshold(entry)).toBe(expected);
  });

  it.each([
    { entry: [0, 15], why: 'a rule that is off' },
    { entry: ['off', 15], why: 'a rule turned off by name' },
    { entry: [2], why: 'a rule without options' },
    { entry: [2, { ignoreTopLevelFunctions: true }], why: 'options without a threshold' },
    { entry: undefined, why: 'a rule the file does not configure' },
  ])('gives null for $why', ({ entry }) => {
    expect(readRuleThreshold(entry)).toBeNull();
  });
});
