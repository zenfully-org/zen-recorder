// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type FoundRegistration, orderScenarios, type Scenario } from './order-scenarios';

const run: Scenario = async () => undefined;
const names = (list: [string, Scenario][]) => list.map(([name]) => name);

function registered(name: string, after: string, file = `scripts/e2e/scenario-${name}.ts`) {
  return { file, name, after, scenario: run } satisfies FoundRegistration;
}

function onRequest(name: string, file = `scripts/e2e/scenario-${name}.ts`) {
  return { file, name, onRequest: true, scenario: run } satisfies FoundRegistration;
}

/** The shape of the run order: a first scenario, a few in between, the ones that must come last. */
const CHAIN = [
  registered('routing', 'start'),
  registered('35', 'routing'),
  registered('84', '35'),
  registered('38', '84'),
  registered('10', '38'),
];

describe('orderScenarios', () => {
  it('runs the scenario that names "start" first, then each one right after the one it names', () => {
    const { run: ordered } = orderScenarios(CHAIN);
    expect(names(ordered)).toEqual(['routing', '35', '84', '38', '10']);
  });

  it('keeps the order whatever order the files were found in', () => {
    const { run: ordered } = orderScenarios([...CHAIN].reverse());
    expect(names(ordered)).toEqual(['routing', '35', '84', '38', '10']);
  });

  it('pairs every name with its own function', () => {
    const scenario: Scenario = async () => undefined;
    const { run: ordered } = orderScenarios([...CHAIN, { ...registered('93', '84'), scenario }]);
    expect(names(ordered)).toEqual(['routing', '35', '84', '93', '38', '10']);
    expect(ordered[3]).toEqual(['93', scenario]);
  });

  it('runs scenarios added after one before the rest of the run, in the order of their names, numbers by value', () => {
    const { run: ordered } = orderScenarios([
      ...CHAIN,
      registered('100', '84'),
      registered('card-b', '84'),
      registered('99', '84'),
    ]);
    expect(names(ordered)).toEqual(['routing', '35', '84', '99', '100', 'card-b', '38', '10']);
  });

  it('runs what follows an added scenario right after it, still before the rest of the run', () => {
    const { run: ordered } = orderScenarios([
      ...CHAIN,
      registered('95', '94'),
      registered('94', 'routing'),
      registered('96', 'routing'),
    ]);
    expect(names(ordered)).toEqual(['routing', '94', '95', '96', '35', '84', '38', '10']);
  });

  it('runs chains as long as each other in the order of their names', () => {
    const { run: ordered } = orderScenarios([
      registered('routing', 'start'),
      registered('b', 'routing'),
      registered('b2', 'b'),
      registered('a', 'routing'),
      registered('a2', 'a'),
    ]);
    expect(names(ordered)).toEqual(['routing', 'a', 'a2', 'b', 'b2']);
  });

  it('keeps the scenarios run only on request out of the run, apart, in the order of their names', () => {
    const { run: ordered, onRequest: apart } = orderScenarios([
      onRequest('soak-b'),
      ...CHAIN,
      onRequest('92'),
    ]);
    expect(names(ordered)).toEqual(['routing', '35', '84', '38', '10']);
    expect(names(apart)).toEqual(['92', 'soak-b']);
  });

  it('runs nothing when no scenario file registers one', () => {
    expect(orderScenarios([])).toEqual({ run: [], onRequest: [] });
  });

  it('refuses a name another file already has, or "start", which is where the run begins', () => {
    expect(() =>
      orderScenarios([
        ...CHAIN,
        registered('93', '84', 'scripts/e2e/scenario-a.ts'),
        registered('93', '35', 'scripts/e2e/scenario-b.ts'),
      ]),
    ).toThrow(
      'scripts/e2e/scenario-b.ts: scenario "93" is registered twice, also in scripts/e2e/scenario-a.ts',
    );
    expect(() =>
      orderScenarios([...CHAIN, onRequest('38', 'scripts/e2e/scenario-soak.ts')]),
    ).toThrow(
      'scripts/e2e/scenario-soak.ts: scenario "38" is registered twice, also in scripts/e2e/scenario-38.ts',
    );
    expect(() => orderScenarios([...CHAIN, registered('start', '10')])).toThrow(
      'scripts/e2e/scenario-start.ts: a scenario may not be named "start": `after: \'start\'` means the beginning of the run',
    );
  });

  it('refuses to run after a scenario nobody registers, or one run only on request', () => {
    expect(() => orderScenarios([...CHAIN, registered('93', '999')])).toThrow(
      'scripts/e2e/scenario-93.ts: scenario "93" runs after "999", which no scenario of the run is named',
    );
    expect(() => orderScenarios([...CHAIN, onRequest('92'), registered('93', '92')])).toThrow(
      'scripts/e2e/scenario-93.ts: scenario "93" runs after "92", which no scenario of the run is named',
    );
  });

  it('refuses scenarios that name each other, which no run order satisfies', () => {
    expect(() =>
      orderScenarios([...CHAIN, registered('93', '94'), registered('94', '93')]),
    ).toThrow(
      'scripts/e2e/scenario-93.ts: scenario "93" runs after "94", which runs after it: a loop',
    );
  });
});
