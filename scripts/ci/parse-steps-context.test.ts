// @vitest-environment node
import { parseStepsContext } from './parse-steps-context';

describe('parseStepsContext', () => {
  it("reads GitHub's steps context (`toJSON(steps)`) in the order the steps ran", () => {
    const json = JSON.stringify({
      checkout: { outputs: {}, outcome: 'success', conclusion: 'success' },
      lint: { outputs: {}, outcome: 'failure', conclusion: 'failure' },
      quality: { outputs: {}, outcome: 'skipped', conclusion: 'skipped' },
    });

    expect(parseStepsContext(json)).toEqual([
      { id: 'checkout', outcome: 'success' },
      { id: 'lint', outcome: 'failure' },
      { id: 'quality', outcome: 'skipped' },
    ]);
  });

  it('takes the outcome, not the conclusion, so a failure allowed to continue still shows', () => {
    const json = JSON.stringify({ probe: { outcome: 'failure', conclusion: 'success' } });

    expect(parseStepsContext(json)).toEqual([{ id: 'probe', outcome: 'failure' }]);
  });

  it('reads no steps from nothing, as when the report runs outside GitHub Actions', () => {
    expect(parseStepsContext(undefined)).toEqual([]);
    expect(parseStepsContext('')).toEqual([]);
  });

  it('refuses a context of another shape', () => {
    expect(() => parseStepsContext('{"lint": {"outcome": "maybe"}}')).toThrow(/steps context/);
    expect(() => parseStepsContext('not json')).toThrow(/steps context/);
  });
});
