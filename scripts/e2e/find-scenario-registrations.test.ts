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

describe('findScenarioRegistrations', () => {
  it('reads the registration each scenario file exports, in file-name order', async () => {
    const found = await findScenarioRegistrations(
      deps({
        'scenario-zz-last.ts': { registration: { name: '94', after: '93', scenario } },
        'scenario-aa-first.ts': { registration: { name: '93', after: '84', scenario } },
      }),
    );
    expect(found).toEqual([
      { file: 'scripts/e2e/scenario-aa-first.ts', name: '93', after: '84', scenario },
      { file: 'scripts/e2e/scenario-zz-last.ts', name: '94', after: '93', scenario },
    ]);
  });

  it('skips the scenario files the list in scripts/e2e-fixture.ts names, which export none', async () => {
    const found = await findScenarioRegistrations(
      deps({ 'scenario-listed.ts': { scenarioListed: scenario } }),
    );
    expect(found).toEqual([]);
  });

  it('loads only scenario files: no test, no helper, nothing else in the folder', async () => {
    const files = deps({ 'scenario-a.ts': {} }, [
      'scenario-a.test.ts',
      'scenarios.ts',
      'harness.ts',
      'scenario-notes.md',
    ]);
    await findScenarioRegistrations(files);
    expect(files.loaded).toEqual(['scenario-a.ts']);
  });

  it('refuses a registration E2E_SCENARIOS could not select, or without its function, naming the file', async () => {
    await expect(
      findScenarioRegistrations(
        deps({ 'scenario-a.ts': { registration: { name: '9 3', after: '84', scenario } } }),
      ),
    ).rejects.toThrow(
      'scripts/e2e/scenario-a.ts: its registration is not { name, after, scenario }',
    );
    await expect(
      findScenarioRegistrations(
        deps({ 'scenario-a.ts': { registration: { name: '93', after: '84' } } }),
      ),
    ).rejects.toThrow(
      'scripts/e2e/scenario-a.ts: its registration is not { name, after, scenario }',
    );
  });
});
