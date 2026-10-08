// @vitest-environment node
import { describeE2eFailure } from '../e2e/describe-e2e-failure';
import { extractE2eFailures } from './extract-e2e-failures';

describe('extractE2eFailures', () => {
  it('reads the scenario, its function and the check that failed, as the e2e run prints them', () => {
    const log = [
      '  ✓ routing (3 s)',
      describeE2eFailure(
        'zoom',
        { name: '35', test: 'scenarioFirstSecondsHaveAudio' },
        new Error('first second: expected -20 dB, got -inf\n    at stack line'),
      ),
      'Error: first second: expected -20 dB, got -inf',
    ].join('\n');

    expect(extractE2eFailures(log)).toEqual([
      {
        tool: 'e2e',
        message: 'first second: expected -20 dB, got -inf',
        file: null,
        line: null,
        column: null,
        rule: null,
        test: 'scenarioFirstSecondsHaveAudio',
        scenario: '35',
        provider: 'zoom',
      },
    ]);
  });

  it('reads a run that failed before its first scenario', () => {
    const log = describeE2eFailure('meet', null, new Error('the browser cannot play audio'));

    expect(extractE2eFailures(log)).toEqual([
      expect.objectContaining({
        message: 'the browser cannot play audio',
        scenario: null,
        test: null,
        provider: 'meet',
      }),
    ]);
  });

  it('finds nothing in a passing run', () => {
    expect(extractE2eFailures('✔ Google Meet passed')).toEqual([]);
  });
});
