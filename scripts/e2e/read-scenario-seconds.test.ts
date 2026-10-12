// @vitest-environment node
/**
 * `E2E_SHARD` splits a service's run by how long each scenario took there on CI, read from
 * `scenario-seconds.json`. A scenario added since the table was measured counts as a typical one
 * of its service, and a service the table does not know splits as if every scenario took as long.
 */
import { readScenarioSeconds } from './read-scenario-seconds';

const TABLE = {
  measured: 'the medians of 19 CI runs',
  seconds: {
    zoom: { '10': 109, '52': 95, '9': 22, '12': 3, routing: 0 },
    meet: { '10': 106 },
  },
};

describe('readScenarioSeconds', () => {
  it("gives each scenario the seconds it took on the service's CI runs", () => {
    const secondsOf = readScenarioSeconds(TABLE, 'zoom');

    expect(['10', '52', '9', '12', 'routing'].map(secondsOf)).toEqual([109, 95, 22, 3, 0]);
  });

  it("counts a scenario the table does not know as the service's median one", () => {
    expect(readScenarioSeconds(TABLE, 'zoom')('99')).toBe(22);
  });

  it('gives every scenario the same time on a service the table does not know', () => {
    const secondsOf = readScenarioSeconds(TABLE, 'teams');

    expect(new Set(['10', '52', 'routing'].map(secondsOf)).size).toBe(1);
  });

  it.each([
    ['no table', undefined],
    ['seconds that are no number', { seconds: { zoom: { '10': 'long' } } }],
    ['negative seconds', { seconds: { zoom: { '10': -1 } } }],
  ])('refuses %s', (_, json) => {
    expect(() => readScenarioSeconds(json, 'zoom')).toThrow('scenario seconds:');
  });
});
