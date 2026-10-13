// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findScenarioRegistrations } from './find-scenario-registrations';

const scenario = async () => undefined;

function deps(modules: Record<string, unknown>, extra: string[] = []) {
  const loaded: string[] = [];
  return {
    loaded,
    listFiles: async () => [...Object.keys(modules), ...extra],
    load: async (file: string) => {
      loaded.push(file);
      return modules[file];
    },
  };
}

const NOT_A_REGISTRATION =
  'scripts/e2e/scenario-a.ts: its registration is not { name, after, scenario } or { name, onRequest: true, scenario }';

describe('findScenarioRegistrations', () => {
  it('reads the registration each scenario file exports, in file-name order', async () => {
    const found = await findScenarioRegistrations(
      deps({
        'scenario-zz-last.ts': { registration: { name: '94', after: '93', scenario } },
        'scenario-aa-first.ts': { registration: { name: '93', after: 'start', scenario } },
        'scenario-soak.ts': { registration: { name: '92', onRequest: true, scenario } },
      }),
    );
    expect(found).toEqual([
      { file: 'scripts/e2e/scenario-aa-first.ts', name: '93', after: 'start', scenario },
      { file: 'scripts/e2e/scenario-soak.ts', name: '92', onRequest: true, scenario },
      { file: 'scripts/e2e/scenario-zz-last.ts', name: '94', after: '93', scenario },
    ]);
  });

  it('refuses a scenario file without a registration, which the run would never run', async () => {
    await expect(
      findScenarioRegistrations(deps({ 'scenario-a.ts': { scenarioA: scenario } })),
    ).rejects.toThrow(
      'scripts/e2e/scenario-a.ts: exports no registration, so no run would ever run its scenario',
    );
  });

  it('loads only scenario files: no test, no helper, nothing else in the folder', async () => {
    const files = deps(
      { 'scenario-a.ts': { registration: { name: 'a', after: 'start', scenario } } },
      ['scenario-a.test.ts', 'scenario-seconds.json', 'harness.ts', 'scenario-notes.md'],
    );
    await findScenarioRegistrations(files);
    expect(files.loaded).toEqual(['scenario-a.ts']);
  });

  it.each([
    ['a name E2E_SCENARIOS could not select', { name: '9 3', after: '84', scenario }],
    ['no function', { name: '93', after: '84' }],
    ['an empty after', { name: '93', after: '', scenario }],
    ['neither after nor onRequest', { name: '93', scenario }],
    ['both after and onRequest', { name: '93', after: '84', onRequest: true, scenario }],
    ['onRequest false', { name: '93', onRequest: false, scenario }],
  ])('refuses a registration with %s, naming the file', async (_, registration) => {
    await expect(
      findScenarioRegistrations(deps({ 'scenario-a.ts': { registration } })),
    ).rejects.toThrow(NOT_A_REGISTRATION);
  });
});
