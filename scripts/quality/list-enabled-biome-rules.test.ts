// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { listEnabledBiomeRules } from './list-enabled-biome-rules';

let folder = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-biome-rules-')));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('listEnabledBiomeRules', { timeout: PROCESS_BUDGET_MS }, () => {
  it('lists the rules the configuration turns on, by group, and none it turns off', () => {
    writeFileSync(
      path.join(folder, 'biome.json'),
      JSON.stringify({
        linter: {
          rules: {
            preset: 'none',
            style: { useTemplate: 'on', useConst: { level: 'warn' } },
            suspicious: { noDebugger: 'error', noConsole: 'off' },
          },
        },
      }),
    );
    expect(listEnabledBiomeRules(folder)).toEqual([
      'style/useConst',
      'style/useTemplate',
      'suspicious/noDebugger',
    ]);
  });
});
