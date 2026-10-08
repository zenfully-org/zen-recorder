// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMetricMessage } from './parse-metric-message';

describe('parseMetricMessage', () => {
  it.each([
    {
      rule: 'sonarjs/cognitive-complexity',
      message:
        'Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed.',
      expected: { metric: 'cognitive-complexity', value: 21, threshold: 15 },
    },
    {
      rule: 'sonarjs/cyclomatic-complexity',
      message: 'Function has a complexity of 13 which is greater than 10 authorized.',
      expected: { metric: 'cyclomatic-complexity', value: 13, threshold: 10 },
    },
    {
      rule: 'sonarjs/max-lines-per-function',
      message:
        'This function has 229 lines, which is greater than the 80 lines authorized. Split it into smaller functions.',
      expected: { metric: 'max-lines-per-function', value: 229, threshold: 80 },
    },
    {
      rule: 'sonarjs/max-lines',
      message:
        'This file has 541 lines, which is greater than 400 authorized. Split it into smaller files.',
      expected: { metric: 'max-lines', value: 541, threshold: 400 },
    },
    {
      rule: 'sonarjs/nested-control-flow',
      message: 'Refactor this code to not nest more than 3 if/for/while/switch/try statements.',
      expected: { metric: 'nested-control-flow', value: 1, threshold: 3 },
    },
    {
      rule: 'sonarjs/expression-complexity',
      message:
        'Reduce the number of conditional operators (4) used in the expression (maximum allowed 3).',
      expected: { metric: 'expression-complexity', value: 4, threshold: 3 },
    },
    {
      rule: 'sonarjs/max-switch-cases',
      message: 'Reduce the number of non-empty switch cases from 31 to at most 30.',
      expected: { metric: 'max-switch-cases', value: 31, threshold: 30 },
    },
    {
      rule: 'sonarjs/no-nested-functions',
      message: 'Refactor this code to not nest functions more than 5 levels deep.',
      expected: { metric: 'no-nested-functions', value: 1, threshold: 5 },
    },
    {
      rule: 'sonarjs/no-identical-functions',
      message:
        'Update this function so that its implementation is not identical to the one on line 29.',
      expected: { metric: 'no-identical-functions', value: 1, threshold: null },
    },
    {
      rule: 'sonarjs/no-duplicate-string',
      message: 'Define a constant instead of duplicating this literal 3 times.',
      expected: { metric: 'no-duplicate-string', value: 3, threshold: null },
    },
    {
      rule: 'max-params',
      message: "Function 'phaseResult' has too many parameters (6). Maximum allowed is 4.",
      expected: { metric: 'max-params', value: 6, threshold: 4 },
    },
    {
      rule: 'max-statements',
      message: 'Async arrow function has too many statements (45). Maximum allowed is 40.',
      expected: { metric: 'max-statements', value: 45, threshold: 40 },
    },
    {
      rule: 'max-nested-callbacks',
      message: 'Too many nested callbacks (4). Maximum allowed is 3.',
      expected: { metric: 'max-nested-callbacks', value: 4, threshold: 3 },
    },
  ])('reads $expected.metric from "$message"', ({ rule, message, expected }) => {
    expect(parseMetricMessage(rule, message)).toEqual(expected);
  });

  it('unwraps the JSON envelope SonarJS puts around a message with secondary locations', () => {
    const message = JSON.stringify({
      message: 'Function has a complexity of 13 which is greater than 10 authorized.',
      cost: 3,
      secondaryLocations: [{ line: 3, column: 2, endLine: 3, endColumn: 4, message: '+1' }],
    });
    expect(parseMetricMessage('sonarjs/cyclomatic-complexity', message)).toEqual({
      metric: 'cyclomatic-complexity',
      value: 13,
      threshold: 10,
    });
  });

  it('ignores a rule the gate does not know, and a message without a rule', () => {
    expect(parseMetricMessage('no-console', 'Unexpected console statement.')).toBeNull();
    expect(parseMetricMessage(null, 'Parsing error: Unexpected token')).toBeNull();
  });

  it('fails loudly when a known rule changed its wording, so a reworded message cannot hide an offender', () => {
    expect(() =>
      parseMetricMessage('sonarjs/cognitive-complexity', 'This function is too complex (21/15).'),
    ).toThrow(/sonarjs\/cognitive-complexity/);
  });
});
