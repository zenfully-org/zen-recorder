// @vitest-environment node
import { describeE2eFailure } from './describe-e2e-failure';

describe('describeE2eFailure', () => {
  it('names the service, the scenario and its function, and the first line of the error', () => {
    const error = new Error('level of the first second: expected -20 dB, got -inf\nmore detail');

    expect(
      describeE2eFailure('zoom', { name: '35', test: 'scenarioFirstSecondsHaveAudio' }, error),
    ).toBe(
      '✘ zoom: scenario 35 (scenarioFirstSecondsHaveAudio) failed: level of the first second: expected -20 dB, got -inf',
    );
  });

  it('says when the run failed before its first scenario', () => {
    expect(describeE2eFailure('meet', null, 'no browser')).toBe(
      '✘ meet: failed before the scenarios: no browser',
    );
  });

  it('describes an error without a message by its name', () => {
    expect(describeE2eFailure('teams', null, new TypeError(''))).toBe(
      '✘ teams: failed before the scenarios: TypeError',
    );
  });
});
