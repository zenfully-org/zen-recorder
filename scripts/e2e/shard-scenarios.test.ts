// @vitest-environment node
/**
 * CI splits each service's end-to-end scenarios over several jobs that run side by side
 * (`E2E_SHARD=<k>/<n>`): each job takes every n-th scenario of the run order, so together they run
 * every scenario once, the long ones spread over the jobs, each in the order the run gives.
 */
import { shardScenarios } from './shard-scenarios';

const SCENARIOS = ['routing', '35', '39', '1', '3', '4', '6', '7'];

describe('shardScenarios', () => {
  it('runs everything without a shard', () => {
    expect(shardScenarios(SCENARIOS, undefined)).toEqual(SCENARIOS);
    expect(shardScenarios(SCENARIOS, '')).toEqual(SCENARIOS);
  });

  it('takes every n-th scenario, from the k-th, in run order', () => {
    expect(shardScenarios(SCENARIOS, '1/3')).toEqual(['routing', '1', '6']);
    expect(shardScenarios(SCENARIOS, '2/3')).toEqual(['35', '3', '7']);
    expect(shardScenarios(SCENARIOS, '3/3')).toEqual(['39', '4']);
  });

  it('runs every scenario exactly once over all the shards', () => {
    const all = [1, 2, 3, 4].flatMap((k) => shardScenarios(SCENARIOS, `${k}/4`));

    expect([...all].sort()).toEqual([...SCENARIOS].sort());
  });

  it('runs everything as the one shard of one', () => {
    expect(shardScenarios(SCENARIOS, '1/1')).toEqual(SCENARIOS);
  });

  it.each(['3', '0/3', '4/3', 'a/b', '1/0', '1/3/2', '-1/3'])('refuses the shard %s', (shard) => {
    expect(() => shardScenarios(SCENARIOS, shard)).toThrow(
      `E2E_SHARD must be <k>/<n> with 1 ≤ k ≤ n, like 2/3; got "${shard}"`,
    );
  });
});
