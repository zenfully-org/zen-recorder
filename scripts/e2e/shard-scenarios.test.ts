// @vitest-environment node
/**
 * CI splits each service's end-to-end scenarios over several jobs that run side by side
 * (`E2E_SHARD=<k>/<n>`). The jobs should end together: the longest scenarios go first, each to the
 * job that has the least time so far, by the seconds each one took on CI. Together the jobs run
 * every scenario once, each job in the order the run gives, and the same list always splits the
 * same way.
 */
import { shardScenarios } from './shard-scenarios';

const SCENARIOS = ['routing', '35', '39', '1', '3', '4', '6', '7'];
const SAME = () => 10;

describe('shardScenarios', () => {
  it('runs everything without a shard', () => {
    expect(shardScenarios(SCENARIOS, undefined, SAME)).toEqual(SCENARIOS);
    expect(shardScenarios(SCENARIOS, '', SAME)).toEqual(SCENARIOS);
  });

  it('takes every n-th scenario, from the k-th, when they all take as long', () => {
    expect(shardScenarios(SCENARIOS, '1/3', SAME)).toEqual(['routing', '1', '6']);
    expect(shardScenarios(SCENARIOS, '2/3', SAME)).toEqual(['35', '3', '7']);
    expect(shardScenarios(SCENARIOS, '3/3', SAME)).toEqual(['39', '4']);
  });

  it('gives the longest scenarios first to the shard with the least time, each in run order', () => {
    const seconds: Record<string, number> = { a: 10, b: 100, c: 30, d: 30, e: 40, f: 5 };
    const names = Object.keys(seconds);
    const secondsOf = (name: string) => seconds[name] ?? 0;

    // b (100) to the first; e, c and d to the second (40, 70, 100); a to the first, which comes
    // first of two shards with as much (110); f to the second (105).
    expect(shardScenarios(names, '1/2', secondsOf)).toEqual(['a', 'b']);
    expect(shardScenarios(names, '2/2', secondsOf)).toEqual(['c', 'd', 'e', 'f']);
  });

  it('ends the shards closer together than every n-th scenario does', () => {
    // A run order with its long scenarios where every third one lands in the same shard.
    const seconds = [100, 10, 10, 90, 10, 10, 80, 10, 10, 70, 10, 10];
    const names = seconds.map((_, position) => `s${position}`);
    const secondsOf = (name: string) => seconds[Number(name.slice(1))] ?? 0;
    const longest = (split: (k: number) => string[]) =>
      Math.max(...[1, 2, 3].map((k) => split(k).reduce((sum, name) => sum + secondsOf(name), 0)));

    expect(longest((k) => shardScenarios(names, `${k}/3`, SAME))).toBe(340);
    expect(longest((k) => shardScenarios(names, `${k}/3`, secondsOf))).toBe(150);
  });

  it('runs every scenario exactly once over all the shards', () => {
    const secondsOf = (name: string) => name.length * 7;
    const all = [1, 2, 3, 4].flatMap((k) => shardScenarios(SCENARIOS, `${k}/4`, secondsOf));

    expect([...all].sort()).toEqual([...SCENARIOS].sort());
  });

  it('splits the same list the same way every time', () => {
    const secondsOf = (name: string) => (name === '35' ? 50 : 10);
    const split = () => [1, 2, 3].map((k) => shardScenarios(SCENARIOS, `${k}/3`, secondsOf));

    expect(split()).toEqual(split());
  });

  it('runs everything as the one shard of one', () => {
    expect(shardScenarios(SCENARIOS, '1/1', SAME)).toEqual(SCENARIOS);
  });

  it.each(['3', '0/3', '4/3', 'a/b', '1/0', '1/3/2', '-1/3'])('refuses the shard %s', (shard) => {
    expect(() => shardScenarios(SCENARIOS, shard, SAME)).toThrow(
      `E2E_SHARD must be <k>/<n> with 1 ≤ k ≤ n, like 2/3; got "${shard}"`,
    );
  });
});
