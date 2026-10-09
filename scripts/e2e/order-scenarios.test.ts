// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type FoundRegistration, orderScenarios, type Scenario } from './order-scenarios';

const run: Scenario = async () => undefined;
const names = (list: [string, Scenario][]) => list.map(([name]) => name);

/** The shape of the run order: a first scenario, a few in between, the ones that must come last. */
const LIST: [string, Scenario][] = [
  ['routing', run],
  ['35', run],
  ['84', run],
  ['38', run],
  ['10', run],
];

function registered(name: string, after: string, file = `scripts/e2e/scenario-${name}.ts`) {
  return { file, name, after, scenario: run } satisfies FoundRegistration;
}

describe('orderScenarios', () => {
  it("keeps today's order when no scenario file registers itself", () => {
    expect(orderScenarios(LIST, [], [])).toEqual(LIST);
  });

  it('runs a registered scenario right after the one it names, and moves no listed one', () => {
    const scenario: Scenario = async () => undefined;
    const ordered = orderScenarios(LIST, [{ ...registered('93', '84'), scenario }], []);
    expect(names(ordered)).toEqual(['routing', '35', '84', '93', '38', '10']);
    expect(ordered[3]).toEqual(['93', scenario]);
  });

  it('runs scenarios that name the same one in the order of their names, numbers by value', () => {
    const ordered = orderScenarios(
      LIST,
      [registered('100', '84'), registered('card-b', '84'), registered('99', '84')],
      [],
    );
    expect(names(ordered)).toEqual(['routing', '35', '84', '99', '100', 'card-b', '38', '10']);
  });

  it('runs a scenario named by another registered one before it, after the listed one they follow', () => {
    const ordered = orderScenarios(
      LIST,
      [registered('95', '94'), registered('94', 'routing'), registered('96', 'routing')],
      [],
    );
    expect(names(ordered)).toEqual(['routing', '94', '95', '96', '35', '84', '38', '10']);
  });

  it('refuses a name the list, the scenarios run on request or another file already has', () => {
    expect(() => orderScenarios(LIST, [registered('38', '84')], [])).toThrow(
      'scripts/e2e/scenario-38.ts: scenario "38" is registered twice, also in the list of scripts/e2e-fixture.ts',
    );
    expect(() => orderScenarios(LIST, [registered('92', '84')], [['92', run]])).toThrow(
      'scripts/e2e/scenario-92.ts: scenario "92" is registered twice, also in the list of scripts/e2e-fixture.ts',
    );
    expect(() =>
      orderScenarios(
        LIST,
        [
          registered('93', '84', 'scripts/e2e/scenario-a.ts'),
          registered('93', '35', 'scripts/e2e/scenario-b.ts'),
        ],
        [],
      ),
    ).toThrow(
      'scripts/e2e/scenario-b.ts: scenario "93" is registered twice, also in scripts/e2e/scenario-a.ts',
    );
  });

  it('refuses to run after a scenario nobody registers, or one run only on request', () => {
    expect(() => orderScenarios(LIST, [registered('93', '999')], [])).toThrow(
      'scripts/e2e/scenario-93.ts: scenario "93" runs after "999", which no scenario of the run is named',
    );
    expect(() => orderScenarios(LIST, [registered('93', '92')], [['92', run]])).toThrow(
      'scripts/e2e/scenario-93.ts: scenario "93" runs after "92", which no scenario of the run is named',
    );
  });

  it('refuses scenarios that name each other, which no run order satisfies', () => {
    expect(() =>
      orderScenarios(LIST, [registered('93', '94'), registered('94', '93')], []),
    ).toThrow(
      'scripts/e2e/scenario-93.ts: scenario "93" runs after "94", which runs after it: a loop',
    );
  });
});
